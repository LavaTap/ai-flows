# strings-encoding — 字符串与文件编码

> 触发条件：字符串 `+`/`+=` 拼接、`%` 或 `.format`、非 ASCII 字符、`# -*- coding`、`reload(sys)`。

## 规则

### STR-01（建议）复杂字符串格式化用 `%` 或 `.format`
- 只有 `a + b` 这种最简单的情况允许用 `+`。

**YES**
```python
x = a + b
x = '%s, %s!' % (imperative, expletive)
x = '{}, {}!'.format(imperative, expletive)
```
**NO**
```python
x = imperative + ', ' + expletive + '!'
x = 'name: ' + name + '; score: ' + str(n)
```

### STR-02（建议）字符串列表拼接用 `''.join`，不要 `+=`
- Python 字符串不可变，每次 `+=` 都新建对象，循环里性能差。
- 前提：列表元素全是 `str`；若混了数字等类型，用 `+=` 也可接受。

**YES**
```python
items = ['<table>']
for last, first in employee_list:
    items.append('<tr><td>%s</td></tr>' % last)
items.append('</table>')
employee_table = ''.join(items)
```
**NO**
```python
employee_table = '<table>'
for last, first in employee_list:
    employee_table += '<tr><td>%s</td></tr>' % last
```

### STR-03（强制）含非 ASCII 字符必须在文件前两行声明编码
```python
# -*- coding: utf-8 -*-
```
- 允许 UTF-8 或 GB18030，推荐 UTF-8。
- 位置必须在前两行。

### STR-04（建议）禁止 `reload(sys); sys.setdefaultencoding('utf-8')`
- 这是 Py2 的老 hack，会带来隐式类型转换、第三方库兼容等问题。
- 正确做法：程序内部统一 `unicode`，边界处尽早 decode、输出时 encode。

## 评审要点速查
- 长串用多个 `+` 拼起来 → STR-01（info）
- 循环里 `s += ...` → STR-02（warning，小循环可豁免）
- 文件里有中文/非 ASCII 但前两行没有 `# -*- coding` → STR-03（blocker，Py2 直接 SyntaxError；Py3 默认 utf-8 降为 info）
- 看到 `reload(sys)` / `setdefaultencoding` → STR-04（warning）
