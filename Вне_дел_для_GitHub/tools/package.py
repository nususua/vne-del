"""Создаёт архив сдачи без параметров подключения и локальных данных."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import re
import sys

root = Path(__file__).resolve().parents[1]
output = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) > 1 else root.parent / 'Вне_дел_ИДЗ1_итог.zip'
excluded_dirs = {'.git', 'history', 'node_modules', '.venv', 'venv', 'dist', 'build', '__pycache__'}
excluded_names = {'.DS_Store', 'config.local.js', '.env'}
files = sorted(path for path in root.rglob('*') if path.is_file()
               and not (set(path.relative_to(root).parts) & excluded_dirs)
               and path.name not in excluded_names
               and not (path.name.startswith('.env.') and path.name != '.env.example')
               and path.suffix not in {'.zip', '.log', '.pyc'})
secret = re.compile(rb'sb_(?:secret|publishable)_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----')
for path in files:
    if path.suffix in {'.js', '.md', '.json', '.sql', '.example', '.command', '.py'} and secret.search(path.read_bytes()):
        raise SystemExit(f'Проверить параметры подключения в {path.relative_to(root)}; архив не создан')
output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, 'vne-del/' + path.relative_to(root).as_posix())
    manifest = '\n'.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(root).as_posix()}' for path in files)
    archive.writestr('vne-del/submission/MANIFEST.sha256', manifest + '\n')
with ZipFile(output) as archive:
    if archive.testzip():
        raise SystemExit('Ошибка проверки архива')
print(f'{output}\nФайлов: {len(files)+1}; размер: {output.stat().st_size:,} байт')
