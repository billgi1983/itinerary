# 把圖片轉byte
import base64


def pic2str(file, function_name):
    pic = open(file, 'rb')
    content = '{} = {}\n'.format(function_name, base64.b64encode(pic.read()))
    pic.close()

    with open('../pic2str.py', 'a') as f:
        f.write(content)


pngs = []
for i in range(0, 7):
    pngs.append(f"{i}.png")

for i in range(0, 8):
    for j in range(0, 8):
        for k in range(0, 7):
            pngs.append(f"{i}{j}{k}.png")

if __name__ == '__main__':
    img_png = []
    for png in pngs:
        pic2str(png, f"p{png.split('.')[0]}_png")
        img_png.append(f"p{png.split('.')[0]}_png")