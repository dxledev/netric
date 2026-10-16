"""Add HTML cache headers to an existing Nginx site without replacing its config."""

import os
from pathlib import Path
import re
import shutil
import sys
import tempfile


INCLUDE = "include /etc/nginx/snippets/netric-html-cache.conf;"
ROOT_LOCATION = re.compile(r"^(?P<indent>[ \t]*)location\s+(?:\^~\s+)?/\s*\{", re.MULTILINE)


def configure(text):
    insertions = []
    for match in ROOT_LOCATION.finditer(text):
        # Ignore braces in quoted directives and comments when finding the block end.
        depth, quote, comment, escaped = 1, None, False, False
        for end in range(match.end(), len(text)):
            char = text[end]
            if comment:
                comment = char != "\n"
            elif escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif quote:
                if char == quote:
                    quote = None
            elif char in "\"'":
                quote = char
            elif char == "#":
                comment = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    break
        else:
            raise ValueError("Unclosed Nginx root location")
        directives = re.sub(r"#.*", "", text[match.end():end])
        if INCLUDE not in directives:
            insertions.append((match.end(), "\n" + match["indent"] + "    " + INCLUDE))
    if not ROOT_LOCATION.search(text):
        raise ValueError("No Nginx root location found; existing config was left unchanged")
    for position, addition in reversed(insertions):
        text = text[:position] + addition + text[position:]
    return text


def main():
    path = Path(sys.argv[1]).resolve(strict=True)
    original = path.read_text()
    updated = configure(original)
    if original == updated:
        return
    backup = path.with_name(path.name + ".before-html-cache")
    if not backup.exists():
        shutil.copy2(path, backup)
    metadata = path.stat()
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            output.write(updated)
            output.flush()
            os.fchmod(output.fileno(), metadata.st_mode)
            os.fchown(output.fileno(), metadata.st_uid, metadata.st_gid)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
