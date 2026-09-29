# iteration — 迭代与推导

> 触发条件：列表/字典/集合推导、`yield`、`readlines()`、`has_key`、遍历 `keys()`/`items()`、生成器表达式。

## 规则

### ITER-01（强制）只读遍历用内置迭代器，不要一次性返回 list
**YES**
```python
for key in adict: ...
if key not in adict: ...
for line in afile: ...
for k, v in adict.items(): ...
```
**NO**
```python
if not adict.has_key(key): ...      # Py3 已删除
for line in afile.readlines(): ...  # 大文件会全量读入内存
```
> 注意：Py3 中 `dict.keys()`/`.items()` 返回视图对象，可直接迭代；只有 Py2 才需要改。遍历时要增删容器才用 `list(...)` 包一层。

### ITER-02（强制，PY013）用 `in` / `not in` 判断元素存在
- 禁止 `dict.has_key(k)`（Py3 已删）。

### ITER-03（建议）返回长列表用 generator
- 数据量大时用 `yield` 替代 `return big_list`，省内存。

**YES**
```python
def odds(n):
    for i in range(1, n + 1):
        if i % 2 == 1:
            yield i
```
**NO**
```python
def odds(n):
    ret = []
    for i in range(1, n + 1):
        if i % 2 == 1:
            ret.append(i)
    return ret
```

### ITER-04（建议，PY011）列表推导限制见 functions.md FUNC-03
- 最多一层 loop + 一层 filter，复杂逻辑展开为 for 循环。

## 评审要点速查
- `for line in f.readlines()` 且文件可能大 → ITER-01（warning）
- `d.has_key(k)` → ITER-02（blocker，Py3 直接报错）
- 函数返回大列表且长度不可控 → ITER-03（info）
- 多层推导 → 跳到 functions.md FUNC-03
