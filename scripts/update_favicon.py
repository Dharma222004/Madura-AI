from pathlib import Path

from PIL import Image

public_dir = Path(__file__).resolve().parents[1] / 'public'
with Image.open(public_dir / 'logo.png') as source:
    logo = source.convert('RGBA')
    logo.resize((64, 64), Image.Resampling.LANCZOS).save(public_dir / 'favicon.png')
    logo.save(
        public_dir / 'favicon.ico',
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
    )

print('Updated Madura AI browser icons from public/logo.png.')
