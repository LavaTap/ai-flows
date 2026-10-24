# imports — import 语句与模块路径

> 触发条件：代码中出现 `import`、`from ... import`、`sys.path`、相对导入（`.`/`..`）。

## 规则

### IMP-01（建议）禁止 `from xxx import yyy` 直接导入类或函数
- `yyy` 只能是 module 或 package，不能是类或函数。
- 目的：调用关系清晰，`x.obj` 表明 `obj` 定义在 `x` 模块，避免命名冲突。

**YES**
```python
from Crypto.Cipher import AES
import os
os.unlink(path)
```
**NO**
```python
from os import unlink
unlink(path)
```

### IMP-02（建议，PY002）禁止 `from xxx import *`
会污染命名空间、掩盖来源，静态分析工具也无法追踪。

### IMP-03（建议，PY003）import 必须用 package 全路径
- 相对 `PYTHONPATH` 的绝对包路径。
- 禁止 `sys.path.append('../../')` 之类修改环境变量。
- 禁止包内相对导入（`.`/`..`），除非项目已明确使用 namespace package 且全仓一致。

### IMP-04（建议，PY037）每行只导入一个库
**YES**
```python
import os
import sys

from third.party import lib
from third.party import foobar as fb

import my.own.module
```
**NO**
```python
import os, sys
from third.party import lib, foobar
```

### IMP-05（建议）import 必须按三段顺序，段间空一行
1. 标准库
2. 第三方库
3. 应用自有库

同段内按字母序。

## 评审要点速查
- 看到 `from os import unlink` → IMP-01
- 看到 `from x import *` → IMP-02
- 看到 `sys.path.append/insert` → IMP-03
- 看到 `import os, sys` 同行 → IMP-04
- 看到标准库和第三方库混排没空行 → IMP-05
