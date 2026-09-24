# boolean — 真值判断与比较

> 触发条件：出现 `is None`、`== True`/`== False`、`if not x`、`== 0`、`while x:` 之类的真值判断。

## 规则

### BOOL-01（强制，PY018）判 None 必须用 `is None` / `is not None`
- 禁止 `== None`、`!= None`。
- 原因：`==` 走 `__eq__`，可能出现 `obj is not None` 但 `obj == None` 为真。

### BOOL-02（强制）已知是 bool 时，禁止与 True/False 比等
**YES**
```python
if expr: ...
if not expr: ...
```
**NO**
```python
if expr == True: ...
if expr != False: ...
```

### BOOL-03（强制）判整数为零，禁止用 `not expr`
- `not expr` 在 `expr` 为 `None` 或空串时也为真，与"是否为 0"语义不同。
**YES**
```python
if foo == 0: ...
if i % 10 == 0: ...
```
**NO**
```python
if not foo: ...
if not i % 10: ...
```

### BOOL-04（建议）慎用隐式真值转换
- Python 中 `None`、`''`、`0`、`()`、`[]`、`{}` 都为假。
- 建议显式 `bool(x)` 或写清判断条件，尤其当变量可能是 `None` 时。
- 推荐写法：`if users is None or len(users) == 0:` 比 `if not users:` 语义更明确。

## 评审要点速查
- `x == None` / `x != None` → BOOL-01（blocker）
- `flag == True` / `flag == False` → BOOL-02（warning）
- `if not n:` 判断数字 → BOOL-03（warning）
- `if not users:` 而 users 可能是 None → BOOL-04（info）
