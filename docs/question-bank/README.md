# 问题题库内容交换文件

- `question-bank-import-template.csv`：项目负责人填写的 UTF-8 CSV 空模板。字段、枚举、条件码、版本和许可语义以根目录 `07-AI访谈引擎规范.md` §10 为准。
- `question-bank-internal-demo.fixture.csv`：仅用于 local/test 或明确 internal demo 的极少量虚构 fixture。它不是产品题库，正式内部试用和 production 必须拒绝激活。

CSV 是内容交换与编辑格式，不是运行时数据库。正式导入必须由 DEV-007A 的受控 validator/import/activate 流程执行；不得要求内容负责人直接编辑数据库，也不得把未知许可或 fixture 内容转成产品 active release。
