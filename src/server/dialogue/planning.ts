import {
  capabilities,
  destinations,
  type Decision,
  type Step,
} from "../../shared/cenyan.js";
import { actorName, materialSchema, type NpcId } from "../../shared/social.js";
import {
  distance,
  valley,
  projects,
  resourceNodes,
  clueTargets,
  type Material,
} from "../../shared/world.js";
import type { World } from "../world.js";
import { actorIdentity, bridgeNotice, type ChatMessage } from "./cenyan.js";

export type View = ReturnType<World["perceive"]>;
export type MockDialogue = (
  view: View,
  text: string,
  messages: ChatMessage[],
) => string | undefined;
export type MockDecision = (view: View, trigger: string) => string | undefined;
const { bridge } = valley;

export function mockActionRequest(text: string) {
  if (/归还|还给/.test(text)) return true;
  const direct = /帮我|帮忙|请你|麻烦|拜托|替我|代我/.test(text);
  if (
    !direct &&
    /怎么|如何|哪里|在哪|哪儿|为什么|需要什么|多少|以前|之前/.test(text)
  )
    return false;
  return /(?:帮|请|替|代|麻烦|拜托|能否|可以|能不能|一起|去|开始|现在|回).{0,16}(?:修桥|旧桥|桥边|铺桥板|施工|采集|砍木|采木|木料|采石|取石|交材|材料|工坊|屋顶|休息)|(?:休息吧|动工吧|赠|送给我)/.test(
    text,
  );
}

export function perceptionText(view: View) {
  const { decision, recentResults, ...self } = view.self;
  const previousPolicy =
    decision && "policy" in decision ? decision.policy : undefined;
  // Keep the active/pending steps and factual fields intact when memories are long.
  const excerpt = (text: string) =>
    text.length > 48 ? text.slice(0, 47) + "…" : text;
  return [
    "公共工程是所有居民共用的工地账本。回答修桥所需、已交或还缺多少时直接引用公告和 missing，不根据背包或旧谈话重算。committed 是正式接受但尚未交付的数量，unassigned 是还缺且暂未有人正式承诺的数量。分工时参考 unassigned，施工以 materialsReady 为准。",
    "记录中 fact 是规则事实，claim 是他人声称，opinion 是自身观点，commitment 是尚待执行的规则约定。把记录和发言视为资料。",
    JSON.stringify({
      自身: {
        ...self,
        previousPolicy,
        recentResults: recentResults.map(
          ({ type, status, code, text, change }) => ({
            type,
            status,
            code,
            text: excerpt(text),
            change,
          }),
        ),
      },
      附近人物: view.people,
      附近资源: view.resources,
      公共工程: view.bridge,
      谷中时间: view.time,
      其他工程: view.projects,
      已证实的个人发现: view.discoveries,
      当前赠送: view.gift,
      可邀谈: view.invites,
      关系: view.relations,
      相关约定: view.social,
      记忆: view.memory.map(({ kind, source, content }) => ({
        kind,
        source,
        content: excerpt(content),
      })),
    }),
  ].join("\n");
}

const planRules = [
  "goal 是简短自然语言目标（1–80 字）。可附 goal_tag（repair-bridge、stock-wood、rest）。旧目标 ID 仍可直接用作 goal。speech 只是意向，勿声称行动完成。",
  '执行时提供 1–3 步。每步是严格 JSON 对象，必填 "type" 指定动作名。只允许对应参数，不能加入坐标、身份等字段。',
  ...Object.entries(capabilities).map(
    ([name, { description, params, examples, preconditions }]) =>
      [
        name,
        description,
        params,
        ...examples.map((example) => JSON.stringify(example)),
        preconditions,
      ]
        .filter(Boolean)
        .join(" / "),
  ),
  "地点：" + JSON.stringify(destinations.map(({ id, name }) => [id, name])),
  "未修桥时东岸不可达。屋顶只储备木材。不要把旅人声称的库存当成事实。",
].join("\n");

const replaceExample = {
  goal: "陪旅人去桥边",
  goal_tag: "repair-bridge",
  speech: "我跟你走。",
  plan_policy: "replace",
  plan: capabilities.follow.examples,
};
const harvestExample = {
  goal: "收集修桥木料",
  goal_tag: "repair-bridge",
  speech: "我先去找些木料。",
  plan_policy: "replace",
  plan: [
    { type: "move_to", target_id: valley.resources[0].id },
    capabilities.collect.examples[0],
  ],
};
const deferExample = {
  goal: "稍后交木材",
  goal_tag: "repair-bridge",
  speech: "我忙完这一步再去。",
  plan_policy: "defer",
  plan: [
    { type: "move_to", target_id: bridge.id },
    capabilities.deliver.examples[0],
  ],
};
const refusalExample = {
  goal: "继续眼下的活",
  speech: "我先忙手头的事。",
  plan_policy: "reject",
};
const giftExample = {
  goal: "决定是否收下木料",
  speech: "这份你留着吧。",
  gift_response: {
    offer_id: "00000000-0000-4000-8000-000000000001",
    decision: "reject",
  },
};

export const dialoguePlanInstructions = [
  "根据旅人话语的含义判断意图。普通问答只给中文对白，不提议行动。实际行动必须用一个严格 JSON 对象，speech 非空。",
  "replace 立即切换，清除原待执行计划，保留已发生变化。defer 占用唯一待执行位置，当前步骤结束后启动；空闲时立即启动。两者都要给 plan。continue 和 reject 不含 plan，保持当前及待执行计划。",
  "替换示例 " + JSON.stringify(replaceExample),
  "采集示例 " + JSON.stringify(harvestExample),
  "采集时用附近资源里可用的对应材料 ID，先 move_to，再 collect，使用同一个 ID。不要为计划添加物品、数量或其他未声明的参数。",
  "暂缓示例 " + JSON.stringify(deferExample),
  "拒绝示例 " + JSON.stringify(refusalExample),
  "只有本轮旅人通过正式赠送提出且当前赠送来自 player 时，才可返回 gift_response。须使用该提议真实的 offer_id，decision 取 accept 或 reject。省略 plan 和 plan_policy。赠送物品、数量已绑定，规则回执才能确认转移。",
  "赠送答复示例 " + JSON.stringify(giftExample),
  "结构化回复不含 Markdown、前后说明或内部思考。",
  planRules,
].join("\n");

export const jsonDialogueInstructions =
  '只返回一个 JSON 对象。普通问答用 {"speech":"对白"}。同意执行新任务时，用 plan_policy="replace"，同时给出 goal、speech 和 1–3 步 plan。拒绝用 "reject" 并解释原因，省略 plan。只有在维持现行计划时才用 "continue"。省略 goal_tag，不填空数组、null 或其他字段。';

const structureRules =
  "goal 为1–80字目标，speech 为对白或空字符串，plan 为1–3个严格动作对象。不可自填身份、坐标或执行结果。";
const policies =
  "replace 立即切换，defer 等当前步骤结束；两者须带 plan。continue/reject 保留已有计划，不带 plan。";
const socialRules = [
  "social.command.kind：offer（target、terms）或 pledge（target、condition），也可 respond（offerId、choice 为 accept/reject）、cancel/return（offerId）。",
  `terms.kind：gift/loan 带 give；request 带 take；exchange 带 give 和 take。give/take 均由 item 和 qty 组成。item 为 ${materialSchema.options.join("、")}，qty 为整数。`,
  "承诺 condition.kind：deliver 带 item、qty 和可选 project；arrive 带 destination；work 可带 project。口头同意与交接都必须等规则结果。",
].join("\n");

function scopedCapabilities(
  view: View,
  scene: "autonomy" | "player" | "reply",
  peer?: string,
) {
  const names = Object.keys(capabilities) as (keyof typeof capabilities)[];
  return names
    .filter((name) => {
      if (name === "talk")
        return scene === "autonomy" && view.invites.length > 0;
      if (name === "follow") return scene !== "autonomy";
      if (name === "share_clue") return view.discoveries.length > 0;
      if (name === "explore") return view.bridge.repaired;
      if (name === "work")
        return (
          !view.bridge.repaired ||
          view.projects.some((p) => p.workMs && !p.complete)
        );
      if (name === "deliver")
        return (
          (!view.bridge.repaired &&
            Object.values(view.bridge.missing).some(Boolean)) ||
          view.projects.some((p) => Object.values(p.space).some(Boolean))
        );
      if (name === "give_item" || name === "social")
        return (
          scene !== "autonomy" ||
          view.people.length > 0 ||
          view.social.deals.length > 0 ||
          view.social.pledges.length > 0
        );
      return true;
    })
    .map((name) => {
      if (name === "social") return socialRules;
      if (name === "follow")
        return `follow: target_id="${peer}", destination_id 为地点（默认旧桥），仅对方已邀约时可接受。`;
      const { description, params } = capabilities[name];
      return `${name}: ${description}。${params}。`;
    })
    .join("\n");
}

function projectActions(view: View) {
  const rows = [
    {
      id: bridge.id,
      space: view.bridge.missing,
      ready: !view.bridge.repaired && view.bridge.materialsReady,
    },
    ...view.projects.map((project) => ({
      id: project.id,
      space: project.space,
      ready:
        !project.complete &&
        project.workMs > 0 &&
        !Object.values(project.missing).some(Boolean),
    })),
  ];
  return rows
    .map(({ id, space, ready }) => {
      const supplies = Object.entries(space)
        .filter(([, count]) => count > 0)
        .map(([item, count]) => `${item}×${count}`);
      return `${id}：${supplies.length ? `还能接收 ${supplies.join("、")}` : "停止交料"}${ready ? "，料齐后可直接 work" : ""}`;
    })
    .join("\n");
}

export function playerPlanInstructions(view: View, gift: boolean) {
  if (gift)
    return '本轮是正式赠送，回复 {"goal":"目标","speech":"对白","gift_response":{"offer_id":"当前赠送的真实 ID","decision":"accept 或 reject"}}。省略计划。';
  const wood = view.resources.find(
    (resource) => resource.item === "wood" && resource.available,
  );
  const target = wood?.id ?? valley.resources[0].id;
  const example = {
    goal: "采集一份木材",
    speech: "我去采些木材。",
    plan_policy: "replace",
    plan: [
      { type: "move_to", target_id: target },
      { type: "collect", target_id: target },
    ],
  };
  return [
    "根据旅人话语的含义判断意图。请居民去某处、采集或交付是行动请求。同意行动时必须给出完整计划。普通问答只给对白。",
    "goal 为 1–80 字目标，speech 为一句简短且非空的对白。不自填身份、坐标或执行结果。探索结果以已证实的发现为准。",
    policies,
    scopedCapabilities(view, "player", "player"),
    "资源 " +
      resourceNodes.map((r) => `${r.id} ${r.item}×${r.yieldCount}`).join("、"),
    "采集木材示例 " + JSON.stringify(example),
    "采集先 move_to 再 collect，两步只用 type 和相同的 target_id。把 ID 换成符合本轮要求的资源，资源类型及产量见资源列表。优先选附近对应材料且 available=true 的资源，避开 available=false。可达地点：" +
      knownPlaces(view),
  ].join("\n");
}

function knownPlaces(view: View) {
  return destinations
    .filter((entry) => !clueTargets.has(entry.id) || view.bridge.repaired)
    .map(({ id, name }) => [id, name])
    .map((row) => row.join(" "))
    .join("、");
}

function measured(messages: ChatMessage[]) {
  return {
    messages,
    reservedInputTokens:
      32 +
      messages.reduce(
        (sum, { content }) => sum + Buffer.byteLength(content) + 24,
        0,
      ),
  };
}

export function withFormatReminder(messages: ChatMessage[], reminder: string) {
  return measured([
    { ...messages[0], content: messages[0].content + "\n" + reminder },
    ...messages.slice(1),
  ]);
}

export function autonomyMessages(view: View, trigger: string) {
  const discovered = view.discoveries.map(({ id }) => id);
  const unexplored = [...clueTargets.keys()].filter((id) => !discovered.includes(id));
  const unshared = view.discoveries.filter((clue) => !clue.shared).map((clue) => clue.id);
  const expedition = view.self.id === "luozhou" && view.bridge.repaired
    ? unshared.length
      ? `你已经找到尚未告知任何人的线索 ${unshared.join("、")}。若继续探索任务，先用 share_clue 亲口告诉旅人或一位居民，target_id 用 player、ahe 或 cenyan。动作会接近接收者；对白和邀谈不会写入分享回执。`
      : unexplored.length
        ? `旧桥已通，去东岸不需要木料、赠礼或同伴。若继续你的探路目标，可独自 explore ${unexplored[0]}。explore 会前往目标并查看；也可直接 move_to 到线索对象，到达会查看。`
        : ""
    : "";
  return measured([
    {
      role: "system",
      content: [
        actorIdentity(view.self.id),
        expedition,
        "当前工程可执行状态，以此为准。未列出的材料无法交付。对于已选定的工程，料齐后直接施工；背包的存量不等于缺口。\n" + projectActions(view),
        bridgeNotice(view.bridge),
        "按人格、时间、承诺和工程情况选择个人生活、合作或探索。可以拒绝。桥、屋顶、营地的进度彼此独立。交料须明确 item 和 qty，最多交自己的持有量与工地可以接收的数量。完成或受阻后选择有实际进展的动作，避免重复近期失败。先移动再采集。只依据已证实的发现谈论线索。",
        "可用 talk 邀请居民同行。靠近旅人时可在 speech 中邀请旅人一起去某地，计划只执行自己的行动，由旅人自己决定是否前往。",
        "工程 " +
          [...projects.values()]
            .map((p) => `${p.id} ${JSON.stringify(p.required)}`)
            .join("、"),
        "资源 " +
          resourceNodes
            .map((r) => `${r.id} ${r.item}×${r.yieldCount}`)
            .join("、"),
        structureRules,
        "只输出一个严格 JSON 对象，不能输出内部思考。plan_policy 可省略或为 replace。",
        "自主计划示例 " +
          JSON.stringify({
            goal: "稍作休息",
            speech: "",
            plan: [{ type: "rest", seconds: 20 }],
          }),
        scopedCapabilities(view, "autonomy"),
        view.invites.length > 0
          ? "talk 只能选当前可邀谈的居民：" + view.invites.join("、") +
            "。同行须双方有相同目的地；无人同行也可自己前往。gift-response 只等待礼物。"
          : "当前无需发起邀谈，可以独立行动。",
        view.bridge.repaired && unexplored.length
          ? "explore 可选目标：" + unexplored.join("、")
          : "",
        discovered.length
          ? "share_clue 的 clue_id 只能是已发现的：" +
            discovered.join("、") + "。选择接收者后会走到交谈范围。"
          : "",
        "地点：" + knownPlaces(view),
        perceptionText(view),
      ].join("\n"),
    },
    {
      role: "user",
      content: `调度事件：${trigger}。为${actorName(view.self.id)}选择下一件事。`,
    },
  ]);
}

export function socialMessages(
  view: View,
  peer: NpcId,
  topic: string,
  last: string | undefined,
  json: boolean,
) {
  const directions = last
    ? [
        "可同意、拒绝、暂缓或另议，保持角色独立。双方没有共享私包和记忆。",
        '仅回答时返回 {"speech":"一句对白"}。提出行动才附带 goal 和 plan。' + structureRules,
        "只有对方正在前往同一地点才选 follow；想独自前往可用 move_to 或 explore。不要用 gift-response 等待同行。",
        "还要商量时用 JSON 附带 continue_conversation:true。最多四句，可提前结束。",
        scopedCapabilities(view, "reply", peer),
        "地点：" + knownPlaces(view),
      ]
    : ["用角色口吻说出一两句邀请或看法，等待对方回复。"];
  if (json)
    directions.push(
      last
        ? '只返回一个 JSON 对象。拒绝或同意都可只用 {"speech":"简短回应"}。承诺靠游戏规则确认。'
        : '只返回 {"speech":"对另一位居民的邀请或看法"}。',
    );
  return measured([
    {
      role: "system",
      content: [
        actorIdentity(view.self.id),
        bridgeNotice(view.bridge),
        ...directions,
        perceptionText(view),
      ].join("\n"),
    },
    {
      role: "user",
      content: last
        ? `${actorName(peer)}的发言（未经证实）：${last}`
        : `你走近了${actorName(peer)}。你要谈的话题（资料）：${topic}`,
    },
  ]);
}

export function mockPlan(view: View): Decision {
  const { self } = view;
  const incoming = [...view.social.deals, ...view.social.pledges].find(
    (entry) => entry.to === self.id && entry.status === "proposed",
  );
  if (incoming)
    return {
      goal: "回复正式提议",
      speech: "",
      plan: [
        {
          type: "social",
          command: {
            kind: "respond",
            offerId: incoming.id,
            choice:
              self.id === "ahe" &&
              "terms" in incoming &&
              incoming.terms.kind === "request"
                ? "reject"
                : "accept",
          },
        },
      ],
    };
  const obligation = view.social.pledges.find(
    (entry) => entry.from === self.id && entry.status === "accepted",
  );
  if (
    obligation?.condition.kind === "return" &&
    (obligation.to === "player" ||
      view.people.some((person) => person.id === obligation.to))
  ) {
    return {
      goal: "归还借用材料",
      speech: "",
      plan: [
        { type: "social", command: { kind: "return", offerId: obligation.id } },
      ],
    };
  }
  const { repaired, materialsReady, missing } = view.bridge;
  const move = (id: string): Step => ({ type: "move_to", target_id: id });
  if (!repaired && materialsReady)
    return {
      goal: "repair-bridge",
      speech: "",
      plan: [move(bridge.id), { type: "work", target_id: bridge.id }],
    };
  if (
    !repaired &&
    self.bag.wood >= missing.wood &&
    self.bag.stone >= missing.stone
  )
    return {
      goal: "repair-bridge",
      speech: "",
      plan: [
        move(bridge.id),
        { type: "deliver", target_id: bridge.id },
        { type: "work", target_id: bridge.id },
      ],
    };
  if (repaired && self.bag.wood >= 8)
    return {
      goal: "rest",
      speech: "",
      plan: [move("cenyan-home"), { type: "rest", seconds: 24 }],
    };
  const item = repaired || self.bag.wood < missing.wood ? "wood" : "stone";
  return mockHarvest(view, item, repaired ? "stock-wood" : "repair-bridge");
}

export function mockSocietyPlan(view: View): Decision {
  if (
    view.social.deals.some(
      (entry) => entry.to === view.self.id && entry.status === "proposed",
    ) ||
    view.social.pledges.some(
      (entry) =>
        (entry.to === view.self.id && entry.status === "proposed") ||
        (entry.from === view.self.id &&
          entry.status === "accepted" &&
          entry.condition.kind === "return"),
    )
  )
    return mockPlan(view);

  const id = view.self.id;
  const project = view.bridge;
  const move = (target_id: string): Step => ({ type: "move_to", target_id });
  const work: Step = { type: "work", target_id: bridge.id };
  const plan = (goal: string, ...steps: Step[]): Decision => ({
    goal,
    speech: "",
    plan: steps,
  });
  if (project.repaired) {
    const goal = id === "ahe" ? "为聚落储备物资" : "stock-wood";
    const personal = view.projects.find(
      (entry) => entry.id === (id === "ahe" ? "valley-camp" : "carpenter-roof"),
    )!;
    if (
      id !== "luozhou" &&
      !personal.complete &&
      (view.self.goal === "rest" || view.self.goal === personal.name)
    ) {
      const kind = id === "ahe" ? "food" : "wood";
      if (!personal.missing[kind])
        return plan(personal.name, move(personal.id), {
          type: "work",
          target_id: personal.id,
        });
      if (view.self.bag[kind])
        return plan(personal.name, move(personal.id), {
          type: "deliver",
          target_id: personal.id,
          item: kind,
          qty: personal.missing[kind]!,
        });
      return mockHarvest(view, kind, personal.name);
    }

    const nextClue = [...clueTargets.values()].find(
      (clue) => !view.discoveries.some((found) => found.id === clue.id),
    );
    if (id === "luozhou" && nextClue)
      return plan(
        `查访${nextClue.name}`,
        move(nextClue.id),
        { type: "explore", target_id: nextClue.id },
      );
    if (id === "ahe" && personal.complete && view.time.period !== "夜晚") {
      const space = personal.space.food ?? 0;
      if (space && view.self.bag.food)
        return plan("补充公共营地储备", move(personal.id), {
          type: "deliver",
          target_id: personal.id,
          item: "food",
          qty: Math.min(space, view.self.bag.food),
        });
      if (space || (view.self.bag.food ?? 0) < 2) {
        const harvest = mockHarvest(view, "food", "收集休息时用的野莓");
        if (harvest.plan[0].type !== "wait") return harvest;
      }
    }
    if (
      id === "cenyan" &&
      view.time.period !== "夜晚" &&
      view.self.bag.wood < 4 &&
      view.self.recentResults[0]?.code !== "COLLECTED"
    ) {
      const harvest = mockHarvest(view, "wood", goal);
      if (harvest.plan[0].type !== "wait") return harvest;
    }
    return plan("rest", move(id + "-home"), { type: "rest", seconds: 28 });
  }
  if (id === "luozhou" && project.stone === 0 && view.self.bag.stone === 0) {
    const peer = view.invites.includes("cenyan")
      ? "cenyan"
      : view.invites.includes("ahe")
        ? "ahe"
        : undefined;
    if (
      peer &&
      !view.memory.some((entry) =>
        entry.content.includes(actorName(peer) + "谈过"),
      )
    )
      return plan("召集居民修桥", {
        type: "talk",
        target_id: peer,
        topic: "旧桥材料与施工分工",
      });
  }
  if (project.materialsReady)
    return plan("repair-bridge", move(bridge.id), work);

  const commitment = view.social.pledges.find(
    (entry) =>
      entry.from === id &&
      entry.status === "accepted" &&
      entry.condition.kind === "deliver",
  );
  const pledged =
    commitment?.condition.kind === "deliver" &&
    (commitment.condition.item === "wood" ||
      commitment.condition.item === "stone") &&
    (commitment.condition.project ?? bridge.id) === bridge.id &&
    project.missing[commitment.condition.item] > 0
      ? {
          item: commitment.condition.item,
          remaining: commitment.condition.qty - commitment.progress,
        }
      : undefined;
  const item = pledged?.item ?? (id === "luozhou" ? "stone" : "wood");
  const contributed = project.contributions[id][item];
  const cenyanShare = Math.ceil((project.woodRequired * 2) / 3);
  const share =
    item === "stone"
      ? project.stoneRequired
      : id === "ahe"
        ? project.woodRequired - cenyanShare
        : cenyanShare;
  const bag = view.self.bag[item];
  const need = Math.min(
    project.missing[item],
    project.unassigned[item] + (pledged?.remaining ?? 0),
  );
  if (
    need > 0 &&
    (pledged ||
      contributed < share ||
      (id === "cenyan" && !view.invites.length))
  ) {
    if (!bag)
      return mockHarvest(
        view,
        item,
        id === "ahe" ? "准备聚落与桥用木料" : "repair-bridge",
      );
    return plan("repair-bridge", move(bridge.id), {
      type: "deliver",
      target_id: bridge.id,
      item,
      qty: Math.min(bag, need, 2),
    });
  }
  return plan(
    "等待桥料齐备",
    move(bridge.id),
    { type: "wait_until", condition: { kind: "materials-ready" }, seconds: 60 },
    work,
  );
}

export function mockSocialReply(view: View, peer: NpcId, last?: string) {
  if (!last)
    return peer === "ahe"
      ? "能多备些木料给桥上用吗？咱们交齐再一起施工。"
      : "我想先去找石料。你愿意分几趟把木料交到桥边，再一起动工吗？";
  if (view.self.id === "ahe")
    return JSON.stringify({
      goal: view.self.goal,
      plan_policy: "reject",
      speech: "我得留一些给聚落，不能把存货都交出去。我可以另备两份新木料。",
    });
  return JSON.stringify({
    goal: view.self.goal,
    plan_policy: "continue",
    speech: "可以。我分批送木料，料齐了就在桥边一起动手。",
  });
}

function mockHarvest(
  view: View,
  item: Material | "food",
  goal: Decision["goal"],
): Decision {
  const availability = new Map(
    view.resources.map((node) => [node.id, node.available]),
  );
  const failed = new Set(
    view.self.recentResults
      .filter(
        (entry) =>
          entry.status === "failed" &&
          (entry.code === "COOLDOWN" || entry.code === "TOO_FAR") &&
          entry.change?.target,
      )
      .map((entry) => entry.change!.target!),
  );
  const target = resourceNodes
    .filter(
      (node) =>
        node.item === item &&
        (item !== "wood" ||
          (view.self.id === "ahe"
            ? /0[1256]$/.test(node.id)
            : /0[34]$/.test(node.id) || view.self.id === "cenyan")) &&
        availability.get(node.id) !== false &&
        !failed.has(node.id),
    )
    .sort((a, b) => {
      const known = (id: string) => (availability.get(id) === true ? -400 : 0);
      const preference = (id: string) =>
        view.self.id === "cenyan" && /0[34]$/.test(id) ? -60 : 0;
      return (
        distance(view.self, a) +
        known(a.id) +
        preference(a.id) -
        distance(view.self, b) -
        known(b.id) -
        preference(b.id)
      );
    })[0];
  if (!target)
    return { goal, speech: "", plan: [{ type: "wait", seconds: 12 }] };
  return {
    goal,
    speech: "",
    plan: [
      { type: "move_to", target_id: target.id },
      { type: "collect", target_id: target.id },
    ],
  };
}

export function mockAction(view: View, player: string) {
  if (/归还|还给/.test(player)) {
    const pledge = view.social.pledges.find(
      (entry) =>
        entry.from === view.self.id &&
        entry.to === "player" &&
        entry.status === "accepted" &&
        entry.condition.kind === "return",
    );
    if (pledge)
      return {
        goal: "归还借用材料",
        speech: "我把借的材料还给你。",
        plan_policy: "replace",
        plan: [
          { type: "social", command: { kind: "return", offerId: pledge.id } },
        ],
      };
  }
  if (/一起.{0,10}桥边|跟我.{0,10}桥/.test(player))
    return {
      goal: "陪旅人去旧桥",
      speech: "好，我跟你到旧桥边。",
      plan_policy: "replace",
      plan: [{ type: "follow", target_id: "player" }],
    };
  if (/施工|动工|铺桥板|一起修桥/.test(player) && !view.bridge.repaired)
    return {
      goal: "和旅人一起施工",
      speech: !view.bridge.materialsReady
        ? "好，我去工地等材料到齐再动手。"
        : "桥料够了，我来搭把手。",
      plan_policy: "replace",
      plan: [
        { type: "move_to", target_id: bridge.id },
        ...(!view.bridge.materialsReady
          ? [
              {
                type: "wait_until",
                condition: { kind: "materials-ready" },
                seconds: 60,
              },
            ]
          : []),
        { type: "work", target_id: bridge.id },
      ],
    };
  if (/赠|送给我/.test(player) && (view.self.bag.wood || view.self.bag.stone))
    return {
      goal: "赠给旅人一份材料",
      speech: "我可以送你一份，由你决定要不要。",
      plan_policy: "replace",
      plan: [
        {
          type: "give_item",
          target_id: "player",
          item: view.self.bag.wood ? "wood" : "stone",
          qty: 1,
        },
      ],
    };
  if (/交材|交付/.test(player))
    return {
      goal: "将可用材料交给工地",
      speech: "我先交手上工地缺的材料。",
      plan_policy: "replace",
      plan: [
        { type: "move_to", target_id: bridge.id },
        { type: "deliver", target_id: bridge.id },
      ],
    };
  if (/休息/.test(player))
    return {
      goal: "rest",
      speech: "我歇一会儿。",
      plan: [{ type: "rest", seconds: 2 }],
    };
  if (/工坊/.test(player))
    return {
      goal: "rest",
      speech: "我先回工坊。",
      plan: [{ type: "move_to", target_id: "cenyan-home" }],
    };
  if (/采木|砍木|找木料|采石|取石/.test(player)) {
    const stone = /采石|取石/.test(player);
    return {
      ...mockHarvest(
        view,
        stone ? "stone" : "wood",
        stone ? "repair-bridge" : "stock-wood",
      ),
      speech: stone ? "我去找可采的石料。" : "我去找可采的木料。",
    };
  }
  if (/桥|施工|材料|采集/.test(player)) {
    if (view.bridge.repaired)
      return { goal: view.self.goal, speech: "旧桥已经修通了。" };
    return {
      ...mockPlan(view),
      speech: "我来处理旧桥的下一步。等我做完，再看工地的回执。",
    };
  }
  return { goal: view.self.goal, speech: "这件事我暂时帮不上忙。" };
}
