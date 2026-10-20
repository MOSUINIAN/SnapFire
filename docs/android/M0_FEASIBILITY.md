# SnapFire 安卓版 M0 可行性验证报告

- 日期：2026-10-20
- 状态：**软件链路通过；真机门禁未完成**
- 依据：`PRD_ANDROID.md` v1.1、`DEV_PLAN_ANDROID.md` v1.1
- 结论：Capacitor + WebView + 原生 WebSocket 方案在当前验证范围内可行；在真机 Android 10 / 4GB 基线设备完成相机、识别和温控验收前，不将 M0 标记为通过。

---

## 1. 验证目标

在投入正式产品代码前验证：

1. Capacitor Android WebView 能否使用前后摄像头；
2. Human.js 离线模型和 WebGL 推理能否在 Android WebView 中运行；
3. 原生 WebSocket 服务能否被多个客户端连接并可靠转发消息；
4. 横竖屏切换是否可用；
5. 当前开发机工具链是否足以构建调试 APK。

---

## 2. 环境与工具链

| 项目 | 结果 |
| --- | --- |
| 开发机 | Windows 11 Home China 10.0.26200，AMD64 |
| Node.js | v26.12.0 |
| npm | 11.20.0 |
| JDK | Eclipse Temurin 21.0.12.1+1（便携目录，未做系统级安装） |
| Android SDK | Platform 36、Build-Tools 36.0.0、Platform-Tools 37.0.1 |
| Android Emulator | 37.2.12，API 36 Google APIs x86_64 |
| Gradle | 8.14.3（本地解压，使用镜像下载） |
| Android Studio | 安装包已下载；静默安装返回 199，未完成安装，M0 不依赖 |
| 真机数量 | **0**（`adb devices` 无设备） |
| 网络限制 | `github.com` 当时不可达；使用清华 JDK 镜像、腾讯 Gradle 镜像、Google SDK/Studio 源 |
| 构建签名 | 仅调试签名；正式 keystore 尚未生成 |

### 工具链说明

- Android SDK CLI 已提示 `sdkmanager` 弃用，实际使用新版 `android` CLI；为兼容旧流程仍保留 `cmdline-tools/latest`。
- 当前环境使用本地 JDK、SDK、Gradle 路径，未依赖 Android Studio 安装。
- M2 前需要解决 Android Studio 安装或改用官方便携 IDE 包，以便 Profiler 和真机调试；这不阻塞当前软件验证。

---

## 3. 验证工程

- 位置：仓库外独立 spike 工程，不进入正式源码。
- 技术组合：Capacitor 8.5.3、React 19、Vite 8、Human 3.3.6、Java-WebSocket 1.6.0。
- 应用 ID：`com.snapfire.m0`（仅验证用）。
- APK：debug，约 16 MB；`compileSdk = 36`、`targetSdk = 36`、`minSdk = 24`（Capacitor 默认；正式产品仍按 PRD 使用 29）。
- 原生插件：`HostServerPlugin`，负责启动局域网 WebSocket、连接事件、消息转发、停止和 IP 枚举；房间规则不在 spike 中实现。
- Human 模型：使用仓库现有 blazeface、faceres、movenet-lightning 离线模型。

---

## 4. 验证结果

### 4.1 构建与安装

| 检查 | 结果 |
| --- | --- |
| Web 资源构建 | 通过 |
| Android debug APK 构建 | 通过（`BUILD SUCCESSFUL`） |
| 安装到模拟器 | 通过 |
| 启动首屏 | 通过，显示 `native: android · secure context: yes` |
| 原生插件注册 | 通过，`HostServer` 调用可到达 Kotlin |

### 4.2 相机

| 检查 | 结果 |
| --- | --- |
| 后置摄像头取景 | 通过（模拟器 virtualscene） |
| 前置摄像头切换 | 通过（模拟器 emulated） |
| 分辨率 | 720×1280 |
| 帧率（模拟器） | 后摄约 53.7 fps，前摄约 60.5 fps |
| 横竖屏 | 竖屏和横屏均可取景 |
| Camera 权限 | 预先通过 `adb pm grant` 授予；尚未完成真实用户拒绝/重授权流程验收 |

**注意：** 模拟器帧率、画面质量、自动对焦和低光表现不代表真机，不得作为相机门禁通过依据。

### 4.3 Human 识别

| 检查 | 结果 |
| --- | --- |
| 模型从 APK 资源加载 | 通过 |
| Human 初始化 | 通过，耗时约 953 ms（模拟器） |
| 推理 | 通过，约 278–296 ms/次（模拟器，640px 中心裁切） |
| 检测调用 | 返回 body/face 结果结构，无崩溃 |
| 真实人体/距离/衣着识别 | **未验证** |
| 长时间温控和内存 | **未验证** |

**注意：** 模拟器虚拟场景无真实语义，识别数值不能用于覆盖率判断；真机 3–6 米/10 米验收仍按 PRD 执行。

### 4.4 原生 WebSocket 与局域网

| 检查 | 结果 |
| --- | --- |
| 服务启动 | 通过，端口 17890 |
| 地址枚举 | 返回 `10.0.2.15`、`10.0.2.16`（模拟器） |
| 6 个客户端同时连接 | 通过，6/6 连接成功 |
| 消息转发 | 通过，6/6 客户端收到 echo 响应 |
| 连接/断开事件 | 通过，客户端计数正确 |
| 停止服务 | 通过，客户端全部断开，UI 收到停止确认 |
| 两台真实手机通过 Wi-Fi/热点直连 | **未验证** |
| 桥接高频广播性能 | 未在真实负载下验证 |
| 安全/权限 | 当前仅 spike 范围，未做正式审计 |

### 4.5 Lint / 测试

- M0 spike 未建立正式的自动化测试套件；它只用于技术可行性。
- 产品侧 M1 共享核心已建立独立测试（见 `TEST_REPORT_ANDROID.md` 或后续正式测试报告）。

---

## 5. M0 门禁判定

| 门禁项 | 状态 |
| --- | --- |
| Capacitor APK 可构建、安装、启动 | 通过 |
| WebView 前后摄基础链路 | 通过（模拟器） |
| Human 模型离线加载和推理链路 | 通过（模拟器） |
| 原生 WebSocket + 6 客户端消息回显 | 通过（模拟器） |
| 横竖屏基础布局 | 通过（模拟器） |
| 真机基线性能 | **未验证 / 未通过** |
| 真实识别精度 | **未验证 / 未通过** |
| 真机温控、续航、内存 | **未验证 / 未通过** |
| 两台以上真机 LAN 直连 | **未验证 / 未通过** |
| 相机权限拒绝/恢复流程 | **未验证 / 未通过** |

**判定：M0 软件可行性通过，M0 门禁整体保持“未通过”。**

依据 PRD 的“不得降低标准”要求，不能把模拟器结果记为真机通过。架构风险仍存在，但已排除“完全跑不起来”这一类风险。

---

## 6. 已知问题与后续动作

1. **真机缺失**：必须补充至少 1 台 Android 10/4GB 基线机和第二台安卓手机。
2. **WebView 注入 safe area CSS 报错**：控制台出现 `Cannot read properties of null (reading 'style')`，当前未观察到功能阻断；M2 需要确认来源并修复或规避。
3. **Android Studio 安装失败**：静默安装 exit 199；M2 前完成 IDE/Profiler 环境。
4. **真机相机权限流程**：需要在真机上验证首次授权、拒绝、永久拒绝和系统设置返回。
5. **真机 WebSocket 网络**：需要在真实 Wi-Fi、热点、AP 隔离环境测试，并测量 6 人广播延迟。
6. **真实识别和温控**：需按 PRD 和后续测试计划记录设备、距离、光照和温度。
7. **产品化原生插件**：spike 的 WebSocket 插件还不是产品级实现；M2 需要加入批量背压、生命周期、错误处理和测试。
8. **正式构建签名**：M9 前生成并离线保管 release keystore。

---

## 7. 结论

- 混合架构值得继续：现有 React/TypeScript、Human 和 Three.js 资产有明确复用路径。
- 当前仅能证明软件通路可行，不能证明目标中端机的 AI/相机性能。
- M1 已按计划开始并完成共享核心抽取；M0 真机门禁作为未关闭项保留，直到设备到位并完成实测。
- 任何后续性能不达标都应触发原生相机/原生推理回退评估，不能用降低识别红线或放宽验收标准的方式掩盖。
