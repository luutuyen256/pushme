from PIL import Image, ImageDraw

def create_simple_icon(size):
    img = Image.new('RGB', (size, size), '#4285f4')
    draw = ImageDraw.Draw(img)
    margin = size // 4
    draw.ellipse([margin, margin, size-margin, size-margin], fill='white')
    return img

for sz in [72, 96, 128, 144, 152, 192, 384, 512]:
    create_simple_icon(sz).save(f'icon-{sz}.png')

create_simple_icon(192).save('icon-192-maskable.png')
create_simple_icon(512).save('icon-512-maskable.png')
create_simple_icon(72).save('badge-72.png')
print('Done!')
