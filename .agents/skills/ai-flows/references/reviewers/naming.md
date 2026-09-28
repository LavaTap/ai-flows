# naming — 命名规范与全局变量

> 触发条件：类名/函数名/变量名/常量名、全大写常量、模块级全局赋值、单/双下划线前缀命名。

## 规则

### NM-01（强制，PY039）类名（含异常）用首字母大写驼峰
- `ClassName`、`ExceptionName`。
- 内部类可加前导下划线：`_InternalClassName`。

### NM-02（强制）常量全大写 + 下划线
- `GLOBAL_CONSTANT_NAME`、`CLASS_CONSTANT_NAME`。
- 模块级 `UPPERCASE` 视为常量；全大写约定优先于"避免全局变量"。

### NM-03（强制）其余一律全小写 + 下划线
- 目录/文件/package/module/function/method/variable/parameter。
- `module_name`、`function_name`、`local_var_name`。

### NM-04（建议）protected / private 前缀
- protected：单下划线 `_internal_function`、`_protected_member`
- private：双下划线 `__private_member`（会触发名称改写）
- 二者都不是真正的访问控制。

### NM-05（建议，PY043）禁止自定义双下划线开头双下划线结尾的名字
- `__init__`、`__call__` 等解释器保留方法除外。
- 自定义 `__foo__` 可能与未来内建钩子冲突。

### NM-06（强制）禁止使用全局变量
- 例外：脚本默认参数、模块级常量。
- 全局变量必须写在文件头部，不得散布在函数之间。

## 评审要点速查
- `class fooBar:` / `class foo_bar:` → NM-01（warning）
- `MAXSIZE = 100` 写成 `maxsize = 100` → NM-02
- `thisIsAVar` → NM-03
- 函数内对模块级变量赋值且无 `global`/nonlocal 说明 → NM-06（warning）
- 模块中间突然出现 `FOO = 1` → NM-06（info）
