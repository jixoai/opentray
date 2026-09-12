上一版更像一个小型 UI framework。

如果目标只是：

> 一个 Native Window 里排列几个 WebView / Native View，并且 resize 时 Native 自己完成布局。

我会把它压缩成一个 **Flex-only Layout DSL**。

### 甚至 JSON 只需要 4 个概念

```json
{
  "dir": "row",
  "gap": 8,
  "children": [
    { "id": "sidebar", "size": 240 },
    {
      "dir": "column",
      "grow": 1,
      "children": [
        { "id": "editor", "grow": 1 },
        { "id": "terminal", "size": 200 }
      ]
    }
  ]
}
```

就够了。

语义：

* `id` → 一个实际 Native View
* `children` → 容器
* `dir` → `row` / `column`
* `size` → 主轴固定尺寸
* `grow` → 占剩余空间
* `gap` → 间距

甚至 **不需要 `type`**。

判断：

```ts
if ("id" in node) {
    // View
} else {
    // Container
}
```

---

## JS API 也可以极简

我会直接设计成：

```ts
row(...)
column(...)
view(...)
```

然后：

```ts
row(
  view('sidebar', 240),
  column(
    grow(
      view('editor')
    ),
    view('terminal', 200)
  )
)
```

但我觉得这里还可以更激进：

### 把 `grow` 变成 `flex`

```ts
row(
  view('sidebar', 240),
  flex(
    column(
      flex(view('editor')),
      view('terminal', 200)
    )
  )
)
```

最终只有：

```ts
row()
column()
view()
flex()
```

四个 primitive。

---

# 我更推荐这个版本

```ts
row(
  view('sidebar', 240),

  flex(
    column(
      flex(view('editor')),
      view('terminal', 200)
    )
  )
)
```

对应 JSON：

```json
{
  "dir": "row",
  "children": [
    {
      "id": "sidebar",
      "size": 240
    },
    {
      "flex": 1,
      "children": [
        {
          "dir": "column",
          "children": [
            {
              "flex": 1,
              "id": "editor"
            },
            {
              "id": "terminal",
              "size": 200
            }
          ]
        }
      ]
    }
  ]
}
```

不过这里我会进一步考虑：

**`flex` 是否真的需要作为一个节点？**

其实完全可以：

```ts
row(
  view('sidebar', 240),
  column(
    { flex: 1 },
    ...
  )
)
```

于是最终 API：

```ts
row(
  view('sidebar', 240),
  column(
    { flex: 1 },
    flex(view('editor')),
    view('terminal', 200)
  )
)
```

---

## 最极简，我其实推荐这样

直接把 **数字解释成固定尺寸，`null`/`*` 解释成 flex**：

```ts
row(
  view('sidebar', 240),
  column(
    view('editor', '*'),
    view('terminal', 200)
  )
)
```

JSON：

```json
{
  "row": [
    ["sidebar", 240],
    {
      "column": [
        ["editor", "*"],
        ["terminal", 200]
      ]
    }
  ]
}
```

这个已经非常接近一个真正的 DSL 了。

```text
240  → fixed
"*"  → flex: 1
```

如果以后需要：

```text
"*"
"2*"
```

自然可以表示：

```text
flex: 1
flex: 2
```

例如：

```ts
row(
  view('sidebar', 240),
  view('editor', '*'),
  view('preview', '2*')
)
```

---

### 我的选择

如果这是 **OpenTray 这种开发者工具内部协议**，我会选：

```ts
row(
  view('sidebar', 240),
  column(
    view('editor', '*'),
    view('terminal', 200)
  )
)
```

JSON：

```json
{
  "row": [
    ["sidebar", 240],
    {
      "column": [
        ["editor", "*"],
        ["terminal", 200]
      ]
    }
  ]
}
```

**非常小、可读、AI 很容易生成，而且天然就是 Flexbox 的一个子集。**

然后 Taffy 只负责把这个 DSL 编译成 Flexbox Style。你甚至可以把整个 JS API + JSON schema 控制在几十行。
