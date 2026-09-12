我建议把它设计成一个**“声明式 View Layout Tree”**，而不是 CSS 的 JS 翻版。

核心原则只有四个：

1. **JSON 是真正的协议（Protocol）**，函数 API 只是它的语法糖。
2. **节点描述布局，不直接描述坐标**；`x/y/width/height` 永远由 Native + Taffy 计算。
3. **View 与 Layout 分离**：布局系统不关心节点最终是 WebView、Terminal 还是原生控件。
4. **Resize 完全 Native 化**：JS 只提交 Tree/Style 变化，窗口尺寸变化不回 JS。

---

# 0. 整体设计

我会把整个系统分成三层：

```text
                 JavaScript
                     │
             Layout DSL / API
                     │
                     ▼
              JSON Layout Tree
                     │
                  IPC / FFI
                     │
                     ▼
             Native Layout Engine
                     │
                  Taffy
                     │
                     ▼
              Rect / View Tree
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
       WebView    Terminal    NativeView
```

这里有一个很重要的边界：

```text
JS:
  “sidebar 宽 240”
  “editor 占剩余空间”
  “terminal 高 200”

Native:
  “sidebar = x0 y0 w240 h800”
  “editor = x240 y0 w1040 h600”
```

JS **永远不负责第二件事**。

---

# 1. JSON Protocol

我建议 JSON 不要做成 CSS 那种扁平的大对象，而是一个非常明确的 Tree。

最基本：

```json
{
  "type": "column",
  "gap": 8,
  "children": [
    {
      "type": "view",
      "id": "toolbar",
      "height": 48
    },
    {
      "type": "row",
      "flex": 1,
      "children": [
        {
          "type": "view",
          "id": "sidebar",
          "width": 240
        },
        {
          "type": "view",
          "id": "editor",
          "flex": 1
        }
      ]
    }
  ]
}
```

语义非常直接：

```text
column
├── toolbar       48
└── row           flex: 1
    ├── sidebar   240
    └── editor    flex: 1
```

---

## 1.1 Node

我建议节点只有两种本质类型：

```ts
type LayoutNode =
  | ContainerNode
  | ViewNode
```

JSON：

```json
{
  "type": "view",
  "id": "editor"
}
```

或者：

```json
{
  "type": "column",
  "children": []
}
```

这里 `row` / `column` **不是不同的 Node 类型**，而是：

```json
{
  "type": "layout",
  "direction": "row"
}
```

这样协议更统一。

---

# 1.2 完整 Style

我建议第一版只暴露这些。

```json
{
  "type": "layout",

  "direction": "row",

  "width": "auto",
  "height": "auto",

  "minWidth": 0,
  "maxWidth": null,

  "minHeight": 0,
  "maxHeight": null,

  "flex": 0,

  "gap": 8,

  "padding": 12,

  "align": "stretch",
  "justify": "start",

  "children": []
}
```

其中尺寸：

```json
"width": 240
```

```json
"width": "auto"
```

或者：

```json
"width": "percent(50)"
```

不过这里我建议**暂时不要引入 `percent()` 字符串**。

直接：

```json
"width": "50%"
```

更自然。

---

# 1.3 `flex`

我建议把 `flex` 简化成一个数字：

```json
{
  "type": "view",
  "id": "editor",
  "flex": 1
}
```

两个：

```json
{
  "type": "view",
  "id": "a",
  "flex": 1
}
```

```json
{
  "type": "view",
  "id": "b",
  "flex": 2
}
```

就是：

```text
剩余空间
 ├──── a 1/3
 └──── b 2/3
```

不要一开始暴露：

```text
flex-grow
flex-shrink
flex-basis
```

因为对于你的用途，这三个 CSS 概念大部分时候都是噪音。

如果未来确实需要，再扩展：

```json
"flex": {
  "grow": 1,
  "shrink": 1,
  "basis": 0
}
```

这样可以保持向后兼容。

---

# 1.4 View 与 Layout 分离

这是协议里我比较强调的设计。

例如：

```json
{
  "type": "layout",
  "direction": "row",
  "children": [
    {
      "type": "view",
      "id": "sidebar",
      "width": 240
    }
  ]
}
```

`view`：

```json
{
  "type": "view",
  "id": "sidebar"
}
```

只意味着：

> 找到一个叫 sidebar 的 Native View。

它不需要知道：

```text
WebView?
WKWebView?
wry?
Terminal?
Canvas?
Native button?
```

这是 View Registry 的事情。

以后甚至可以：

```json
{
  "type": "view",
  "id": "preview"
}
```

Native：

```text
preview → WebView
```

而：

```json
{
  "type": "view",
  "id": "terminal"
}
```

Native：

```text
terminal → PTY Terminal View
```

Layout Engine 完全不关心。

---

# 1.5 一个稍微完整的例子

```json
{
  "type": "layout",
  "direction": "column",
  "children": [
    {
      "type": "view",
      "id": "toolbar",
      "height": 48
    },
    {
      "type": "layout",
      "direction": "row",
      "flex": 1,
      "gap": 1,
      "children": [
        {
          "type": "view",
          "id": "sidebar",
          "width": 240
        },
        {
          "type": "layout",
          "direction": "column",
          "flex": 1,
          "children": [
            {
              "type": "view",
              "id": "editor",
              "flex": 1
            },
            {
              "type": "view",
              "id": "terminal",
              "height": 240
            }
          ]
        }
      ]
    }
  ]
}
```

这个已经足够覆盖你绝大多数 WebView 编排场景。

---

# 2. JS Function API

然后函数 API **不要和 JSON 协议设计两套东西**。

应该做到：

```text
Function API
      ↓ compile
JSON
      ↓
Native
```

所以函数 API 本质就是 JSON Builder。

---

## 2.1 最底层 API

我建议：

```ts
layout(style?, children?)
view(id, style?)
```

例如：

```ts
layout(
  { direction: 'row' },
  [
    view('sidebar', { width: 240 }),
    view('editor', { flex: 1 })
  ]
)
```

---

# 2.2 再提供 `row / column`

作为纯语法糖：

```ts
row([
  view('sidebar', { width: 240 }),
  view('editor', { flex: 1 })
])
```

等价于：

```ts
layout(
  { direction: 'row' },
  [...]
)
```

Column：

```ts
column([
  view('toolbar', { height: 48 }),
  view('content', { flex: 1 })
])
```

---

# 2.3 `fixed / grow`

这里我觉得可以提供。

```ts
fixed('sidebar', 240)
```

等价：

```ts
view('sidebar', {
  width: 240
})
```

而：

```ts
grow('editor')
```

等价：

```ts
view('editor', {
  flex: 1
})
```

于是复杂布局可以变得非常漂亮：

```ts
row([
  fixed('sidebar', 240),

  grow(
    column([
      grow('editor'),
      fixed('terminal', 240)
    ])
  )
])
```

我很喜欢这个 API，因为**它把最常见的布局意图直接表达出来了**。

---

# 2.4 `gap / padding`

不要让用户为了一个 gap 写 style object。

可以提供：

```ts
row([
  fixed('sidebar', 240),
  grow('editor')
], {
  gap: 8
})
```

或者：

```ts
row({ gap: 8 }, [
  fixed('sidebar', 240),
  grow('editor')
])
```

我更推荐后者：

```ts
row(
  { gap: 8 },
  [
    fixed('sidebar', 240),
    grow('editor')
  ]
)
```

这样参数顺序统一：

```ts
row(style, children)
column(style, children)
layout(style, children)
```

---

# 2.5 最终 API

我会让用户日常只需要记住：

```ts
row()
column()
view()
fixed()
grow()
```

例如：

```ts
layout(
  column(
    { gap: 8, padding: 8 },

    [
      fixed('toolbar', 48),

      grow(
        row(
          { gap: 8 },

          [
            fixed('sidebar', 240),

            grow(
              column(
                {},

                [
                  grow('editor'),
                  fixed('terminal', 200)
                ]
              )
            )
          ]
        )
      )
    ]
  )
)
```

甚至可以进一步省略 `layout()`：

```ts
column(
  { gap: 8, padding: 8 },
  [
    fixed('toolbar', 48),

    grow(
      row(
        { gap: 8 },
        [
          fixed('sidebar', 240),

          grow(
            column([
              grow('editor'),
              fixed('terminal', 200)
            ])
          )
        ]
      )
    )
  ]
)
```

我觉得这已经非常接近一个**优秀的 UI Layout DSL** 了。

---

# 3. 一个我认为很重要的设计：不要实时同步

你的核心问题其实不是布局 API，而是 **JS ↔ Native 的生命周期**。

所以我会设计：

```ts
const tree = column([...])

window.setLayout(tree)
```

而不是：

```ts
view.width = ...
view.height = ...
view.x = ...
view.y = ...
```

一次：

```text
JS
 ↓
setLayout(JSON)
 ↓
Native
 ↓
Taffy
```

之后：

```text
window resize
 ↓
Native
 ↓
Taffy
 ↓
setFrame()
```

JS 不参与。

---

# 4. 动态改变布局

如果用户点击了：

```text
“打开 Terminal”
```

JS 不应该重新计算整个布局。

可以：

```ts
layout.set(
  column([
    grow('editor'),
    fixed('terminal', 240)
  ])
)
```

Native：

```text
new JSON
 ↓
update tree
 ↓
Taffy
 ↓
apply
```

但我甚至建议再往前一步：

### 给 Node 一个稳定 ID

```json
{
  "type": "view",
  "id": "terminal",
  "height": 240
}
```

然后支持：

```ts
layout.update('terminal', {
  height: 300
})
```

这样未来可以做真正的 **incremental layout**：

```text
JS:
  update terminal height

Native:
  update Taffy node
       ↓
  mark dirty
       ↓
  recompute
       ↓
  apply affected views
```

这会非常快。

---

# 5. 最终我建议你把协议控制在这个规模

第一版：

```ts
type Style = {
  width?: number | string
  height?: number | string

  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number

  flex?: number

  direction?: 'row' | 'column'

  gap?: number
  padding?: number | [number, number, number, number]

  align?: 'start' | 'center' | 'end' | 'stretch'
  justify?: 'start' | 'center' | 'end' | 'space-between'
}

type Node =
  | {
      type: 'view'
      id: string
      style?: Style
    }
  | {
      type: 'layout'
      style?: Style
      children: Node[]
    }
```

JS：

```ts
view()
row()
column()
fixed()
grow()
```

**这五个东西实际上就已经构成了你的第一版 DSL。**

我尤其建议你**不要把它设计成“CSS in JSON”**。你的真实需求是 *native view orchestration*，所以 `fixed()` / `grow()` 这种**布局意图型 API**反而是这套系统最有价值的部分。
