---
name: "spreadsheet-processor"
description: "Parses and processes spreadsheet files (Excel, WPS, CSV, etc.). Invoke when user mentions wps, table, excel or when parsing spreadsheet files."
---

# Spreadsheet Processor Skill

## 概述

本技能用于解析和处理各种电子表格文件格式，包括 Excel、WPS、CSV、OpenDocument 等多种格式。当用户提到相关关键词或需要解析特定文件格式时，自动触发。

---

## 触发条件

### 关键词触发

当用户提到以下关键词时自动触发：
- `wps`
- `表格`
- `excel`
- `wps表格`
- `电子表格`
- `spreadsheet`

### 文件格式触发

当需要解析或处理以下文件格式时自动触发：

| 文件格式 | 扩展名 | 说明 |
|---------|---------|------|
| **Excel** | `.xls` | Excel 97-2003 格式 |
| **Excel** | `.xlsx` | Excel 2007+ 格式 |
| **Excel** | `.xlsm` | 带宏的 Excel 格式 |
| **Excel** | `.xlsb` | Excel 二进制格式 |
| **CSV** | `.csv` | 逗号分隔值 |
| **OpenDocument** | `.ods` | OpenDocument 电子表格 |
| **WPS** | `.et` | WPS 电子表格格式 |
| **dBase** | `.dbf` | dBase 数据库文件 |
| **Access** | `.accdb` | Access 2007+ 数据库 |
| **Access** | `.mdb` | Access 97-2003 数据库 |
| **文本** | `.prn` | Lotus 1-2-3 格式 |
| **TSV** | `.tsv` | 制表符分隔值 |
| **Numbers** | `.numbers` | Apple Numbers 格式 |

---

## 核心功能

### 1. 文件格式识别

自动识别和验证电子表格文件格式，确保使用正确的解析工具。

### 2. 数据读取与解析

支持从多种格式读取数据：
- 工作表读取
- 单元格数据提取
- 公式解析
- 格式信息获取

### 3. 数据操作

- 数据筛选
- 数据排序
- 数据转换
- 数据聚合

### 4. 文件写入与导出

支持导出为多种格式：
- Excel (.xlsx)
- CSV
- JSON
- Markdown 表格

---

## 使用示例

### 读取 Excel 文件

使用 Excel MCP 工具读取文件：

```typescript
// 使用 mcp_Excel_excel_read_sheet 读取工作表
// 使用 mcp_Excel_excel_describe_sheets 列出所有工作表
```

### 处理 CSV 文件

```typescript
// 解析 CSV 文件内容
// 处理数据行
// 转换为结构化数据
```

### 数据导出

```typescript
// 将数据导出为 Markdown 表格
// 或使用 mcp_Excel_excel_write_to_sheet 写入 Excel
```

---

## 最佳实践

### 1. 大文件处理

- 对于大型电子表格，建议分批读取
- 使用流式处理避免内存溢出
- 优先处理关键工作表

### 2. 数据验证

- 验证单元格数据类型
- 检查空值和缺失数据
- 验证公式计算结果

### 3. 格式保留

- 保留重要的单元格格式
- 处理合并单元格
- 注意隐藏行/列

---

## 可用的 MCP 工具

本技能配合以下 MCP 工具使用：

### Excel MCP 工具

- `mcp_Excel_excel_read_sheet` - 读取工作表数据
- `mcp_Excel_excel_describe_sheets` - 列出工作表信息
- `mcp_Excel_excel_write_to_sheet` - 写入工作表
- `mcp_Excel_excel_copy_sheet` - 复制工作表
- `mcp_Excel_excel_create_table` - 创建表格
- `mcp_Excel_excel_format_range` - 格式化单元格范围
- `mcp_Excel_excel_screen_capture` - 屏幕截图

---

## 常见问题

### Q: 如何处理带密码保护的 Excel 文件？

A: 目前需要先手动解除密码保护，然后再处理。

### Q: 支持中文文件名和路径吗？

A: 支持，请确保文件路径编码正确。

### Q: 大文件处理有什么限制吗？

A: 建议分批处理，避免一次性加载过大文件。

---

## 相关资源

- [Excel MCP 文档](待补充)
- [Pandas 文档](https://pandas.pydata.org/)
- [OpenPyXL 文档](https://openpyxl.readthedocs.io/)

---

**最后更新**: 2026-04-10  
**维护者**: DevOps Team
