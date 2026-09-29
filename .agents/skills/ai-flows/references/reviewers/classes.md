# classes — 类设计

> 触发条件：出现 `class`、`__init__`、`@property`、继承、单/双下划线成员、`object` 基类。

## 规则

### CLS-01（建议）构造函数要简单
- `__init__` 不能包含可能失败或过于复杂的操作。
- 复杂初始化拆到 `init()` / `configure()` 等独立方法。
- 什么叫"过于复杂"由 reviewer 判定：涉及 IO、网络、大计算、多分支即算。

### CLS-02（强制）禁止在派生类重写 property 的实现
- property 在基类绑定到实现函数，子类同名 `__get_xxx` 不会生效。
- 如需派生类定制行为，改用普通方法 + 模板方法模式。

**NO**
```python
class MySquare(Square):
    def __get_area(self):
        return math.pi * self.side ** 2   # 不会生效
```

### CLS-03（建议，PY046）无基类必须显式继承 `object`
**YES**
```python
class SampleClass(object):
    pass
```
**NO**
```python
class SampleClass:
    pass
```
> Py3 默认就是 new-style class，此条对纯 Py3 项目可降级为 info；若兼容 Py2 则是强制。

### CLS-04（建议）protected / private 前缀约定
- protected：单下划线 `_member`
- private：双下划线 `__member`（触发名称改写）
- 两者都不是真正的访问控制，只是模块作者与调用方的约定。

### CLS-05（建议，PY043）不要自定义双下划线开头双下划线结尾的名字
- 类似 `__foo__` 会与 Python 解释器内部钩子冲突。
- `__init__`、`__call__` 等解释器保留方法除外。

## 评审要点速查
- `__init__` 里有 IO / 网络 / 长逻辑 → CLS-01（warning）
- 子类定义了和基类 property 同名的 `__get_xxx` → CLS-02（blocker，静默失效）
- Py2 兼容代码里裸 `class Foo:` → CLS-03（warning）；纯 Py3 项目降为 info
- 自己定义了 `__foo__` 方法 → CLS-05（warning）
