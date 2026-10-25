# B 固定空间包

复用 `fisher_shop` / `e-stall`；两处钓区，共 7 席。源为 `apps/web/public/world-map-life-v1.json`，SHA256 `740961688871187a4d058a00822073283bc19642508ff128229c4420cb60b4b0`。本目录是设计候选，生产地图与规则切换归 TD / A / D。

| stationId | spotId | 站立格 | 接近格 | 朝向 |
|---|---|---|---|---|
| harbor_shore-01 | shore_spot | 44,5 | 45,5 | 左 |
| harbor_shore-02 | shore_spot | 44,7 | 45,7 | 左 |
| harbor_shore-03 | shore_spot | 44,11 | 45,11 | 左 |
| harbor_shore-04 | shore_spot | 44,13 | 45,13 | 左 |
| harbor_pier-01 | pier_spot | 41,10 | 41,9 | 左 |
| harbor_pier-02 | pier_spot | 43,10 | 43,9 | 左 |
| harbor_pier-03 | pier_spot | 45,10 | 45,9 | 左 |

地图坐标源为 `spatial-manifest.json`，不可由 API 或渲染端另猜点。源像素脚底为 `[520+16*x,520+16*y]`；96×64 动画脚底 `[48,39]`。全部完整人物／工具水平翻转朝左，等待帧线尾相对脚底约 `[-30,+23]`，7 个落水点已分别验证在非栈台水格。线尾只是视觉，不生成占用、鱼获或动作结果。

`npc-fishing-clerk` 在 `[28,17]`，脚底 `[968,792]`，接近格 `[27,17]`；采用原生 `sunnyside-human-spikeyhair`，维持同一 appearance catalog。短号由分配器处理，不硬写 N005。店员不站在门格／狭路，离岗不关闭自助交易。

新图 `world-map-life-b-v1.json` 使用 ruleset/topology/mapManifest **4** 的候选值。仅把四个岸钓格和店员格这 **5 个原未开放干燥格**改可走；原 1175 可走格、1622 物理阻挡格保留，结果 1180 可走／2830 未开放。旧图不覆盖。为使原生鱼线不落在装饰船上，仅将无碰撞 `boat-a` 从 `[41,12]` 移到 `[39,18]`，不添加船舶服务。31 建筑、两桥、栈台、阶梯、水域与原 A 站位／等待格保留。

`build-spatial.py` 是仅写本设计目录的可复现生成／检查；`geometry-delta.json` 记录增量，`spatial-validation.json` 保存实际路线。A 的 13 席、6 等待位及 B 的 7 席与店员同时占用时，31 建筑入口和新钓位接近点仍可达；相对于相同 A 满占条件，新增断开的公共格为 0。原 A 满占时本就隔离的 `[49,14]`、`[51,14]` 单列，没有将其误报为 B 新断路或全部格通过。未做运行时人群／调度／经济验收。

工程落位建议：`apps/web/public/world-map-life-b-v1.json` 为新独立文件；A 的旧图继续保留。`apps/web/public/world-life/spatial-manifest.json` 由本包 revision 2 替换并同步服务端精确 SHA。runtime `geometryDigest` 必须由 A 的规范转换器对新图实际计算，不能拿文件 SHA 替代。前后端 map.js、life readers、town validation 与 catalog／规则转换必须在同批对齐；不要为了沿用旧 1175 计数而静默放宽校验。现行活跃路线／活动跨地图版本的处置归 A / TD，不由设计包改写事实。
