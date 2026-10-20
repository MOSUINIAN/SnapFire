# SnapFire 安卓版测试报告

- 更新日期：2026-10-20
- 当前阶段：M1 完成，M2 软件实现进行中，M0 真机门禁未关闭
- 依据：`PRD_ANDROID.md` v1.1、`DEV_PLAN_ANDROID.md` v1.3
- 测试原则：失败必须保留，不可通过删除测试、放宽断言或把未执行项写成通过来满足门禁。

---

## 1. 当前结论

| 项目 | 结果 |
| --- | --- |
| Windows 版回归 | 通过 |
| M1 共享核心测试 | 通过 |
| 移动 Web 构建 | 通过 |
| M0 软件可行性 | 通过（仅模拟器） |
| M0 真机门禁 | **未通过/未执行** |
| M2 原生网络层 JVM 测试 | 通过（4/4） |
| M2 调试 APK 构建/安装/启动 | 通过（仅模拟器） |
| 安卓正式功能验收 | 尚未开始 |

---

## 2. 测试环境

| 项目 | 值 |
| --- | --- |
| 主机 | Windows 11 Home China 10.0.26200，AMD64 |
| Node.js | v26.12.0 |
| npm | 11.20.0 |
| JDK | Temurin 21.0.12.1+1 |
| Android SDK | Platform 36 / Build-Tools 36.0.0 |
| Android 模拟器 | API 36 Google APIs x86_64 |
| Android 真机 | 0 台 |
| Windows 版 Electron | 44.9.0 |

---

## 3. 自动化测试

### 3.1 命令与结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | 主进程 + 渲染进程 |
| `npm test` | 通过 | 8 个测试文件、44 项测试 |
| `npm run build` | 通过 | Windows Electron 生产构建 |
| `npm run build:mobile-web` | 通过 | 生成 `dist-mobile/`，约 15 MB（含模型） |
| Windows 单实例启动检查 | 通过 | Playwright 启动构建产物，等待 `.home-screen` 成功 |
| `gradle testDebugUnitTest`（Android） | 通过 | 4 项原生 WebSocket JVM 测试，0 失败 |
| `gradle assembleDebug`（Android） | 通过 | 生成 21 MB debug APK |
| 产品 APK 模拟器安装/启动 | 通过 | API 36 模拟器可安装并加载 WebView；未验证真机 |

### 3.2 测试明细

| 测试文件 | 覆盖 | 数量 |
| --- | --- | --- |
| `tests/descriptors.test.ts` | 人脸/衣着相似度和身份匹配 | 8 |
| `tests/net.test.ts` | 房主地址规范化 | 6 |
| `tests/storage.test.ts` | 文件存储、历史、备份、恢复、损坏文件 | 10 |
| `tests/lanServer.test.ts` | WebSocket 房间/比赛完整规则 | 3 |
| `tests/resultsScreen.test.ts` | 结算页渲染 | 2 |
| `tests/roomEngine.test.ts` | 注入时钟、假传输、倒计时、伤害、复活、房主离开 | 4 |
| `tests/storageCore.test.ts` | 档案、设置、历史、备份校验、文件名 | 8 |
| `tests/platform.test.ts` | 平台包装、桌面/浏览器适配器边界 | 3 |
| **合计** | | **44** |

### 3.3 Android 原生 JVM 测试

`android/app/src/test/java/com/snapfire/mobile/net/LanWebSocketServerTest.java`

| 测试 | 结果 |
| --- | --- |
| 单客户端连接、消息回传、停止后清理 | 通过 |
| 6 个客户端同时连接与广播 | 通过 |
| 起始端口被占用时自动回退 | 通过 |
| 向未知客户端发送消息被拒绝 | 通过 |
| **合计** | **4/4 通过** |

构建/安装/启动：
- `gradle assembleDebug` 通过，APK 约 21 MB。
- API 36 x86_64 模拟器安装成功。
- 应用启动后 Human 模型成功加载，日志出现 `[vision] Human loaded with WebGL backend` 与 `[vision] warmup complete`。
- 当前产品 Web 包仍使用浏览器平台适配器，尚未接入原生存储/Android 平台适配器；不能视为 M2 完成。
- 首页仍是桌面布局，M3 移动端布局尚未开始。

### 3.4 Windows 单实例启动检查

- 使用独立临时 userData 启动 Electron 构建产物。
- 成功显示 `.home-screen`，页面标题为 `SnapFire`。
- 首页显示本地身份、离线状态、团战入口和本地统计数据。
- 未出现 `window.snapfire` 缺失错误或渲染崩溃。
- 该检查不等同于双实例联机/摄像头冒烟；双实例假摄像头门禁仍按既有测试记录与环境限制单独处理。

---

## 4. M0 可行性验证

详细报告：`docs/android/M0_FEASIBILITY.md`

| 验证项 | 结果 | 是否计入真机门禁 |
| --- | --- | --- |
| 调试 APK 构建/安装/启动 | 通过 | 部分（软件链路） |
| 模拟器前后摄 | 通过 | 否 |
| 模拟器横竖屏 | 通过 | 否 |
| Human 模型加载/推理 | 通过 | 否 |
| 原生 WebSocket 6 客户端 | 通过 | 否 |
| 真机相机/识别/性能 | 未执行 | 是 |
| 2 台真机 LAN | 未执行 | 是 |
| 相机权限拒绝/重授权 | 未执行 | 是 |

---

## 5. 已知问题

1. **无真机**：无法完成 M0 门禁，不能进入仅依赖模拟器的“通过”结论。
2. **safe area CSS 控制台错误**：模拟器 spike 中出现 `Cannot read properties of null (reading 'style')`；需在 M2 定位。
3. **Android Studio 未安装**：静默安装失败；CLI 构建可用，但 Profiler/IDE 验证待补。
4. **M0 spike 非正式代码**：无产品级自动化测试，不作为正式功能通过依据。
5. **Windows 双实例假摄像头冒烟**：当前开发环境存在假摄像头争用，需在正式回归前修复或提供可靠运行条件；不影响本次 44 项自动化测试和单实例启动验证。
6. **Android 平台适配器仍为浏览器占位**：当前产品 APK 能启动，但本地数据仍走浏览器适配器，原生存储、SAF、二维码等尚未接入；不得据此宣称 M2 完成。
7. **模拟器启动耗时**：M2 模拟器日志显示模型预热约 30 秒，不能代表真机；需在 M0 真机门禁中测量达标情况。
8. **桌面布局未移动化**：当前首页是桌面布局，M3 才进行移动端信息架构和触摸适配。

---

## 6. 下一步测试门禁

1. 接入至少 1 台 Android 10 / 4GB 基线机和第二台安卓真机。
2. 完成 M0 真机相机、Human 性能、温度、内存和双机 LAN 测试。
3. 完成 M2 后，按计划对原生相机权限、WebSocket、安全存储、SAF、二维码和生命周期进行测试。
4. M5/M6 执行识别红线和完整对局测试。
5. M9 在干净设备、无互联网、2~6 台真机环境完成 PRD 第 8 节全部 P0 验收。

**未通过项不会因为后续开发而自动视为通过。**
