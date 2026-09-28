# formatting — 排版与空白

> 触发条件：行尾分号、行长、缩进（含 Tab）、空行、冗余括号、运算符两侧空格、`=` 在默认参数里的空格。

## 规则

### FMT-01（建议，PY021）禁止以分号结束语句
**NO**
```python
do_thing();
```

### FMT-02（建议，PY022）一行只能写一条语句
**NO**
```python
foo = 1; bar = 2
```

### FMT-03（强制，PY023）每行 ≤ 120 字符
- 字符串过长用括号隐式拼接：
```python
x = ('This will build a very long long '
     'long long long long long long string')
```

### FMT-04（强制）缩进用 4 个空格，禁止 Tab
- 续行对齐：要么与首行括号对齐，要么首行留空、第二行起 4 空格悬挂。
- 禁止 2 空格悬挂。

### FMT-05（建议，PY027）空行
- 文件级定义（class / 顶层 def）之间隔 **两个**空行。
- 类内方法之间隔 **一个**空行。

### FMT-06（建议）避免冗余括号
**YES**
```python
if foo:
    bar()
return foo
for (x, y) in d.items(): ...   # tuple 解包允许
```
**NO**
```python
if (x): bar()
if not(x): bar()
return (foo)
```

### FMT-07（建议，PY028）括号内侧不加空格
**YES** `spam(ham[1], {eggs: 2}, [])`
**NO**  `spam( ham[ 1 ], { eggs: 2 }, [ ] )`

### FMT-08（建议，PY029）函数名与左括号之间不加空格；索引左括号前不加空格
**YES** `spam(1)` `d['k']` `a[i]`
**NO**  `spam (1)` `d ['k']`

### FMT-09（强制，PY030）逗号/分号/冒号前不加空格，后面加一个空格
**YES**
```python
if x == 4:
    print(x, y)
```
**NO**
```python
if x == 4 :
    print(x , y)
```

### FMT-10（强制，PY031）二元运算符前后各一个空格
**YES** `x == 1`、`a + b`
**NO**  `x<1`、`a+b`

### FMT-11（强制，PY032）关键字参数 / 默认值 `=` 两侧不加空格
**YES**
```python
def complex(real, imag=0.0):
    return magic(r=real, i=imag)
```
**NO**
```python
def complex(real, imag = 0.0):
    return magic(r = real, i = imag)
```

## 评审要点速查
- 行尾 `;` → FMT-01；同一行两条语句 → FMT-02
- 超过 120 字符 → FMT-03（warning）
- Tab 缩进或 2 空格悬挂 → FMT-04（blocker/警告）
- 顶层函数间只有一个空行 → FMT-05
- `if (x):` / `return (foo)` → FMT-06
- `spam (x)` / `d ['k']` → FMT-08
- `if x==4:` / `a+b` → FMT-10
- `def f(a = 1):` → FMT-11
