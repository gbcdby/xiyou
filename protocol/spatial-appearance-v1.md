# 空间公开造型扩展

适用 [#33](https://github.com/gbcdby/xiyou/issues/33)、[#34](https://github.com/gbcdby/xiyou/issues/34) 与 ADV-001 v0.2 的身份投影边界。字段源为 [spatial-schema.mjs](spatial-schema.mjs)，本扩展不改变世界解释器、动作、实体引用、名字或外观版本的原有语义。

## 字段及来源

`EntityViewV2` 与 `SelfViewV2` 增加可选 `appearanceId: AppearanceIdV2`。它只是**当前可见造型的公开资源键**，不是角色、真身或控制者身份。值由服务端按已提交的当前外观与内容映射生成；不能从模型输出、客户端字段或观察者显示称呼反推。

允许值为 `neutral`、`gaocai`、`courtyard-helper`、`carpenter`、`kitchen-helper`、`woodcutter`、`tang`、`wukong`、`bajie`、`cuilan`、`gao`、`witness`。未知内容或没有明确映射时服务端使用 `neutral`。这组键对应公开造型，不能把内部 `characterId` 原样填入。

真实翠兰与借貌中的悟空都必须为 `cuilan`，两者仍有独立 `entityRef`、位置与操作目标。知情者的称呼可以是“悟空·借貌”，其 `appearanceId` 仍是 `cuilan`；未识破者与知情者看到同一当前外形。解除借貌后才随权威 `appearanceEpoch` 的变化回到 `wukong`。客户端在外观版本变化时清除旧造型帧，缺字段或没有本地资源时用中性造型，禁止退回姓名、顺序或真实身份猜图。

## 显式兼容协商

旧 `spatial-v2` 严格 reader 使用 `additionalProperties: false`，不能接收新字段。可选字段仅保证**新 reader 能读旧 DTO**，不表示旧 reader 能读新 DTO。因此本扩展增加 `spatial-appearance-v1` 能力，与 `spatial-v2` 并列声明：

```json
["spatial-v2", "spatial-appearance-v1"]
```

新客户端在创建、加入、Socket 鉴权及 HTTP snapshot 的能力声明中使用上述集合；HTTP 仍通过现有 `X-Xiyou-Capabilities` 头传递逗号分隔值。服务端只向声明 `spatial-appearance-v1` 的连接或读取请求输出 `appearanceId`，对只声明 `spatial-v2` 的请求继续输出原字段集。snapshot、batch、sync、control response、重连与终态视图都必须沿用同一能力选择，不得在某一出口无条件加字段。

内部可信 AI 读取可显式选择含造型的授权投影；模型合同也只能携带该公开字段，不能据它授予物权、同意、控制或新知识。旧 region-v1 的字段源、动作、事件及回放不受本扩展影响。

## 分工与检查范围

本合同测试覆盖新 reader 接受旧/新形状、有限键及未知身份字段拒绝。真实造型映射、真翠兰/借貌悟空同形、不同知识观察者一致、解除后的变化，以及未协商客户端不收到字段，由运行时投影与网络检查取证；合同文件存在不代表这些运行义务已经通过。界面按固定合同选图，不自行推导服务端身份。
