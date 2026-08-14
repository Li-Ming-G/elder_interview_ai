# Interview Director v2 Draft 编辑说明

状态：`DRAFT / NOT RUNTIME LOADABLE / NOT A FORMAL VERSION`。

项目负责人可直接编辑本目录的 `system.md` 与 `task.md`。当前 runtime loader 仍固定读取相邻 `v1/`，本目录没有 formal version/digest，也不得被 import、部署或用于真实访谈。

## 编辑边界

1. Prompt 只描述角色、任务、输入材料语义、阶段服从、题库可选和输出行为；不要复制 Context/Output Schema 的字段表。
2. 如果想新增字段、枚举或交叉约束，先修改并接收 `docs/contracts/interview-director-context.schema.json` 或 `interview-director-output.schema.json`，再继续改 draft。
3. `journey_stage` 是后端权威值；Prompt 不能让模型重新判断并维护另一套阶段。`bank_references=[]` 合法，模型可以完全不用题库。
4. 不要写入真实姓名、转录、录音、密钥、provider endpoint 或账号。示例只能使用明确虚构内容。

## 发布流程

`draft` 可反复修改。准备比较时，从一个 exact Git head 冻结 system/task 字节、正式 Context/Output Schema、model-config policy 和 digest，形成新的 immutable `candidate`。candidate 必须运行固定 `docs/evaluations/interview-director/synthetic-v1/cases.json`，且多模型使用同一冻结输入。任何文字修改都产生新 candidate/digest，不能覆盖旧 candidate。

只有项目负责人接收 candidate、评测证据、exact head 和 CI 后，才能新增 immutable formal v2 bundle。formal v2 与 runtime loader 切换仍需单独受审；不得重命名本目录来绕过门禁，也不得覆盖 v1。
