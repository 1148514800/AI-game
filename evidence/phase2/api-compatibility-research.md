# Chat Completions公开契约核对（2026-11-24，Asia/Shanghai）

公开官方API参考：https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create

- 参数支持按供应商/模型而异；max_tokens兼容传统服务，但o-series不支持，max_completion_tokens覆盖可见输出和reasoning。
- 适配层应明确配置支持的单一token上限参数，不盲发thinking、response_format、temperature等供应商能力参数。
- usage.prompt_tokens/completion_tokens/total_tokens若返回则记录；completion_tokens_details.reasoning_tokens属于completion_tokens子集，不能重复加费。其他细分字段原样保留为usage明细，不把缺失当零或当实测。
- 无真实项目Key/额度授权，没有执行真实供应商调用。测试HTTP桩只能证明协议/超时/错误/预算实现，不能证明模型人格或生成能力。
