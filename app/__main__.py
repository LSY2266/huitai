"""启动方式：python -m app（或双击 huitai.exe）"""
import uvicorn

from . import config


def main():
    if getattr(__import__("sys"), "frozen", False):
        # PyInstaller 冻结环境：没有 app.main 模块可做字符串导入，
        # 直接传应用对象（workers 必须为 1，数据库级抢占已保证并发正确）
        from .main import app as application
        uvicorn.run(application, host=config.HOST, port=config.PORT, workers=1)
    else:
        uvicorn.run("app.main:app", host=config.HOST, port=config.PORT, workers=1)


if __name__ == "__main__":
    main()
