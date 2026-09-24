# functions — 函数设计

> 触发条件：出现 `def`、多返回值、默认参数、`lambda`、装饰器、嵌套函数、三目表达式、函数长度超过一屏。

## 规则

### FUNC-01（强制）函数返回值 ≤ 3 个
- 超过 3 个必须用 class / namedtuple / dict 等具名形式包装。
- 目的：调用方要记顺序，多了极易用错。

**YES**
```python
Person = collections.namedtuple('Person', 'name gender age weight')
def get_person_info():
    return Person('jjp', 'MALE', 30, 130)
```
**NO**
```python
def get_person_info():
    return 'jjp', 'MALE', 30, 130
name, gender, age, weight = get_person_info()
```

### FUNC-02（建议，PY016）默认参数只能用基本类型字面量/常量
允许：`int`、`bool`、`float`、`str`、`None`。
禁止：可变对象（list/dict/自定义对象）、运行时求值（`time.time()`、`FLAGS.x`）。

**YES**
```python
def foo(a, b=None):
    if b is None:
        b = []
```
**NO**
```python
def foo(a, b=[]): ...
def foo(a, b=time.time()): ...
```

### FUNC-03（建议，PY011）列表推导最多一层 loop + 一层 filter
- mapping / loop / filter 各自最多一段，禁止多层 loop 或 filter 嵌套。
- 复杂情况展开成普通 for 循环。

**YES**
```python
result = []
for x in range(10):
    for y in range(5):
        if x * y > 10:
            result.append((x, y))
```
**NO**
```python
result = [(x, y) for x in range(10) for y in range(5) if x * y > 10]
```

### FUNC-04（建议，PY014）lambda 只能一行
- 复杂逻辑必须改成具名 `def`。

### FUNC-05（建议）条件表达式只用于单行，禁止嵌套
**YES**
```python
x = true_value if cond else false_value
```
**NO**
```python
unit = "seconds" if t < 60 else "minutes" if t < 3600 else "hours"
```

### FUNC-06（建议）不推荐嵌套/局部/内部类或函数
- 除非闭包等明确场景，否则提到模块级。

### FUNC-07（建议）装饰器仅限必要场景
- `@property`、`@classmethod`、`@staticmethod`、测试框架要求的装饰器可以用。
- 自定义装饰器要谨慎：import 时执行、改签名难排查。

### FUNC-08（强制，PY024）函数长度 ≤ 120 行
- 超过说明职责过多，应拆分。

### FUNC-09（建议）善用 `*args` / `**kwargs`
- 可变参数、关键字参数允许使用，不视为违规。

## 评审要点速查
- `return a, b, c, d` 四个裸值 → FUNC-01（blocker）
- `def f(x=[])` / `={}` / `=time.time()` → FUNC-02（warning）
- 推导式里两层 `for` 或 `if` 套 `if` → FUNC-03（info/warning）
- lambda 里有 `if/else` 或多个表达式 → FUNC-04（info）
- 三目套三目 → FUNC-05（warning）
- 函数 > 120 行 → FUNC-08（warning）
