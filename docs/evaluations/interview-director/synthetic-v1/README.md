# Interview Director 固定虚构评测集 v1

状态：`FIXED SYNTHETIC EVALUATION INPUT / NO REAL DATA`。

`cases.json` 只含人工编写的虚构内容，用于冻结 candidate 后做多模型横评。每轮比较必须记录相同的 Context Schema/Output Schema、Prompt candidate version+digest、model-config policy 和每个 case 的 canonical input digest；所有模型使用完全相同的 case bytes。

评测输出只写隔离 artifact，可记录结构化输出、sanitized provenance、token、latency 和人工评价。禁止调用 QuestionEvidence writer，禁止写 current/history/actual asked/memory，禁止把结果用于真实访谈 shadow traffic。该评测不构成真实 provider、数据地区、DPA、ASR、问题质量或试点 PASS。

`review_criteria` 是人工评价提示，不是 Output Schema 新字段，也不发送给模型。要修改 case 或 criteria，必须发布新的 evaluation set version，不能原地改已用于 candidate 的固定版本。
