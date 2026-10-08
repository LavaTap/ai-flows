# resources-entry — 资源关闭、入口与日志

> 触发条件：`open()`、`socket`、`with`、`if __name__ ==`、shebang `#!`、`logging`、`unittest`、模块级全局赋值。

## 规则

### RES-01（建议）文件 / socket 用完必须显式关闭，优先 `with`
- 不要依赖对象析构时自动关闭——Python 何时 GC 不确定，可能耗尽句柄。

**YES**
```python
with open('hello.txt') as f:
    for line in f:
        print(line)
```
**NO**
```python
f = open('hello.txt')
for line in f:
    print(line)
# 没有 f.close()
```

### RES-02（建议）模块必须可导入；主程序放 `if __name__ == '__main__':`
- 顶层不要直接执行业务代码，否则 `import` 该模块就会跑主逻辑。

**YES**
```python
def main():
    ...

if __name__ == '__main__':
    main()
```

### RES-03（建议）脚本 shebang
- 可执行脚本第一行：`#!/usr/bin/env python`（或 `python3`）。

### RES-04（建议）日志用 `logging`，不要裸 `print` 打线上日志
- 推荐格式：`%(levelname)s: %(asctime)s: %(filename)s:%(lineno)d * %(thread)d %(message)s`
- 线上建议两个文件：全量 + warning/error/critical。

### RES-05（建议）单元测试
- 用 `unittest`；测试文件与被测代码同名加 `_test` 后缀（如 `foo_test.py`），放独立 test 目录。

### RES-06（强制）禁止全局变量
- 例外：模块级常量、脚本默认参数。详见 naming.md NM-06。

## 评审要点速查
- `f = open(...)` 后没有 `with` / 没有 `f.close()` / 异常路径会漏关 → RES-01（warning/blocker）
- 模块顶层直接调 `main()` 或跑业务逻辑 → RES-02（warning）
- 可执行脚本没有 shebang → RES-03（info）
- 线上代码用 `print` 打日志 → RES-04（warning）
- 测试文件名不规范或和源码混放 → RES-05（info）
