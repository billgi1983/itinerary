# 把圖片轉byte
import base64


def pic2str(file, function_name):
    pic = open(file, 'rb')
    content = '{} = {}\n'.format(function_name, base64.b64encode(pic.read()))
    pic.close()

    with open('../pic2str.py', 'a') as f:
        f.write(content)


if __name__ == '__main__':
    png = "000.png"
    pic2str(png, f"p{png.split('.')[0]}_png")