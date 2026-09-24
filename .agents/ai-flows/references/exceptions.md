# exceptions — 异常抛出与捕获

> 触发条件：代码中出现 `raise`、`except`、`try`、自定义异常类、`Error` 基类。

## 规则

### EXC-01（强制，PY004）禁止旧式 raise 语法
- 禁止 `raise MyException, 'msg'`
- 禁止 `raise 'Error Message'`
- 正确：`raise MyException` 或 `raise MyException('msg')`

### EXC-02（强制）自定义异常必须有统一基类
- 模块内定义 `class Error(Exception): pass`
- 其它自定义异常都从 `Error` 派生。
- 目的：调用方可以 `except Error` 一把接住本模块所有异常。

### EXC-03（强制）禁止裸 `except:`
- 除非紧跟着 `raise` 重新抛出。
- 否则裸 `except` 会捕获 `KeyboardInterrupt`、`SystemExit`、语法错误等底层异常。
- 捕获 `Exception`/`StandardError` 也要谨慎；若必须捕获，必须把异常信息写进日志。

### EXC-04（强制，PY007）捕获必须用 `as` 语法
**YES**
```python
try:
    raise Error
except Error as error:
    pass
```
**NO**
```python
except Error, error:
    pass
```

### EXC-05（建议）try 块尽量小
- 只把可能抛错的那一两行放进 `try`，避免把未预期异常也吞掉。

### EXC-06（建议）清理逻辑放 `finally`
- 文件关闭、句柄释放等无论是否异常都要执行的代码，放 `finally`（或用 `with`，见 resources-entry.md）。

## 评审要点速查
- 看到 `raise X, 'msg'` 或 `raise '...'` → EXC-01（blocker）
- 定义了多个自定义异常但没有统一基类 → EXC-02（blocker）
- 看到 `except:` 且后面没 `raise` → EXC-03（blocker）
- 看到 `except X, e:` → EXC-04（blocker，Py3 直接语法错误）
- try 块包了几十行 → EXC-05（warning/info）
