# docstrings — 注释与文档字符串

> 触发条件：三引号 docstring、文件头版权注释、`# TODO:` 注释。

## 规则

### DOC-01（强制，PY033）module / function / class / method 接口必须用 docstring
- 必须用三个双引号 `"""`。
- 用三个单引号 `'''` 不规范。
- 对外接口必写；内部接口可写可不写。

### DOC-02（强制，PY034）docstring 至少包含
- 功能简介
- 参数（Args）
- 返回值（Returns）
- 可能抛出的异常（Raises）——如果有

### DOC-03（强制）每个文件必须有文件头声明
包含：版权、功能简介、修改人及联系方式。示例：
```python
#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Copyright (c) 2014 Baidu.com, Inc. All Rights Reserved

This module provide configure file management service.

Authors: jiangjinpeng(jiangjinpeng@baidu.com)
Date: 2014/04/05 17:23:06
"""
```

### DOC-04（建议）TODO 格式固定
```
# TODO: 干什么事情 $负责人(邮箱前缀) $最终期限(YYYY-MM-DD) $
```
示例：
```
# TODO: Improve performance using concurrent operation. $jiangjinpeng$2014-04-05$
```

## 评审要点速查
- 顶层函数/类没有 docstring → DOC-01（warning，对外接口为 blocker）
- docstring 用 `'''` → DOC-01（info）
- 函数有参数/返回但 docstring 里没写 → DOC-02（warning）
- 文件开头没有版权/作者/功能说明 → DOC-03（info/warning）
- `# TODO xxx` 没有负责人和日期 → DOC-04（info）
