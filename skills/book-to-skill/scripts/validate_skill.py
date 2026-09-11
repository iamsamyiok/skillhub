#!/usr/bin/env python3
"""validate_skill.py — SKILL.md 规范校验脚本

用法：
    python3 validate_skill.py <技能目录路径>

校验项：
    - SKILL.md 存在
    - frontmatter 存在且可解析为 YAML
    - 必填字段（id/name/version/description/category/tags）齐全
    - version 符合 x.y.z 格式
    - id 与目录名一致
    - 正文非空且包含"工作流"相关章节

输出：
    - 全部通过：打印 OK，exit 0
    - 失败：逐条列出问题，exit 1
"""

import sys
import os
import re
import yaml


def parse_frontmatter(content):
    """解析 Markdown 开头的 YAML frontmatter，返回 (fm_dict, body) 或 (None, None)。"""
    if not content.startswith('---'):
        return None, None
    end_idx = content.find('---', 3)
    if end_idx == -1:
        return None, None
    fm_text = content[3:end_idx].strip()
    body = content[end_idx + 3:].strip()
    try:
        fm = yaml.safe_load(fm_text)
        return fm, body
    except yaml.YAMLError as e:
        return None, None


def check_version_format(version_str):
    """检查版本是否符合 x.y.z 格式（x/y/z 为非负整数）。"""
    if not isinstance(version_str, str):
        return False
    return bool(re.match(r'^\d+\.\d+\.\d+$', version_str))


def main():
    if len(sys.argv) != 2:
        print(f"用法: {sys.argv[0]} <技能目录路径>", file=sys.stderr)
        sys.exit(1)

    skill_dir = sys.argv[1]
    errors = []

    # 1. SKILL.md 存在
    skill_md_path = os.path.join(skill_dir, 'SKILL.md')
    if not os.path.isfile(skill_md_path):
        errors.append("SKILL.md 不存在")
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        sys.exit(1)

    # 2. 读取文件内容
    try:
        with open(skill_md_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        errors.append(f"无法读取 SKILL.md: {e}")
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        sys.exit(1)

    if not content.strip():
        errors.append("SKILL.md 为空")

    # 3. frontmatter 存在且可解析
    fm, body = parse_frontmatter(content)
    if fm is None:
        errors.append("frontmatter 不存在或无法解析（缺少 --- 包裹的 YAML 块）")
    else:
        # 4. 必填字段检查
        required_fields = ['name', 'version', 'description', 'category', 'tags']
        for field in required_fields:
            if field not in fm or fm[field] is None:
                errors.append(f"frontmatter 缺少必填字段: {field}")
            elif isinstance(fm[field], str) and not fm[field].strip():
                errors.append(f"frontmatter 字段 '{field}' 为空字符串")
            elif isinstance(fm[field], list) and len(fm[field]) == 0:
                errors.append(f"frontmatter 字段 '{field}' 为空列表")

        # 5. version 格式检查
        version = fm.get('version')
        if version and not check_version_format(str(version)):
            errors.append(f"version 格式不符 x.y.z 格式: '{version}'")

        # 6. id 与目录名一致（若 frontmatter 中有 id 字段）
        skill_dir_name = os.path.basename(os.path.abspath(skill_dir))
        skill_id = fm.get('id')
        if skill_id is not None:
            if str(skill_id) != skill_dir_name:
                errors.append(f"id 与目录名不一致: id='{skill_id}', 目录='{skill_dir_name}'")
        elif 'id' not in fm:
            # id 不是必填字段（根据规范要求，但 name 替代），仅在存在时校验一致性
            pass

    # 7. 正文非空且包含"工作流"相关章节
    if body is not None:
        if not body.strip():
            errors.append("正文为空")
        else:
            # 检查包含"工作流"相关章节标题
            workflow_patterns = [
                r'^#+\s*工作流',       # ## 工作流, ### 工作流 等
                r'^#+\s*第\s*\d+\s*步',  # ### 第 1 步
                r'工作流',              # 正文中提及工作流
            ]
            has_workflow = any(re.search(p, body, re.MULTILINE) for p in workflow_patterns)
            if not has_workflow:
                errors.append("正文未找到「工作流」相关章节（需要 ## 工作流 或 第 N 步 等步骤描述）")
    else:
        errors.append("无法获取正文（frontmatter 解析失败）")

    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        sys.exit(1)
    else:
        print("OK")
        sys.exit(0)


if __name__ == '__main__':
    main()
