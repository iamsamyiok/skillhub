import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
OUT = ROOT / "catalog.jsonl"
BASE_URL = "https://huggingface.co/datasets/codepawl/simready-glb/resolve/main"

CATEGORY_ZH = {
    "food": "食物", "kitchenware": "厨具", "box": "盒子", "handTool": "手动工具",
    "consumable": "耗材", "paint": "油漆", "bodyPart": "人体模型", "pallet": "托盘",
    "equipment": "设备", "serviceTool": "维修工具", "engineComponent": "发动机零件",
    "container": "容器", "instrument": "仪器", "stationery": "文具", "crate": "周转箱",
    "cleaning": "清洁用品", "sign": "标识牌", "testingTool": "检测工具", "cabinet": "柜子",
    "rack": "货架", "suspension": "悬挂系统", "vehicleSupport": "车辆支撑",
    "powerTool": "电动工具", "storage": "储物", "dishware": "餐具", "lighting": "照明",
    "tape": "胶带", "interiorPart": "内饰件", "decor": "装饰", "drivetrain": "传动系统",
    "factory": "工厂", "structure": "结构件", "coolingSystem": "冷却系统", "drum": "圆桶",
    "fixture": "夹具", "fuelSystem": "燃油系统", "ladder": "梯子", "ppe": "防护用品",
    "trolley": "手推车", "brakeSystem": "刹车系统", "cart": "推车", "computer": "电脑",
    "electricalSystem": "电气系统", "safety": "安全", "steeringSystem": "转向系统",
    "device": "设备", "medicine": "药品", "tool": "工具", "toy": "玩具", "utensil": "器皿",
    "blinds": "百叶窗", "exhaustSystem": "排气系统", "pail": "提桶", "screen": "屏幕",
    "utensils": "器皿", "airSystem": "进气系统", "chair": "椅子", "lamp": "灯",
    "monitor": "显示器", "trashCan": "垃圾桶", "warehouse": "仓储", "wheelAssembly": "车轮总成",
    "socket": "插座", "syringe": "注射器", "fireProtection": "消防", "furniture": "家具",
    "IV": "输液", "paper": "纸张", "table": "桌子", "appliance": "家电", "bottle": "瓶子",
    "bucket": "桶", "climate": "气候设备", "conveyor": "传送带", "hvac": "暖通空调",
    "needle": "针头", "pack": "包装", "refrigerator": "冰箱", "stationary": "固定物",
    "tireTool": "轮胎工具", "wire": "电线", "barrier": "路障", "bin": "垃圾箱",
    "electrical": "电气", "environment": "环境", "light": "灯", "vehicle": "车辆",
    "wasteManagement": "废弃物管理", "blood": "血液", "case": "箱", "disinfectant": "消毒剂",
    "engineAssembly": "发动机总成", "handTruck": "手推车", "modular": "模块化",
    "sofa": "沙发", "Xray": "X光", "bandage": "绷带", "construction": "施工",
    "detector": "探测器", "digitalSystem": "数字系统", "extrusion": "型材",
    "hardware": "五金件", "hopper": "料斗", "ibcTank": "吨桶", "palletJack": "液压搬运车",
    "paperbag": "纸袋", "pipe": "管道", "pump": "泵", "robotic": "机器人", "sanitary": "卫生洁具",
    "steering": "转向", "storageSystem": "仓储系统", "tiltTruck": "翻斗车", "trash": "垃圾",
    "unit": "机组", "ventilation": "通风", "waste": "废料", "anesthesia": "麻醉",
    "bed": "床", "drainage": "排水", "drape": "铺巾", "engine": "发动机",
    "facilitySystem": "设施系统", "fireExtinguisher": "灭火器", "machine": "机器",
    "machineGuard": "机器防护", "measurement": "测量", "panel": "面板", "power": "电力",
    "prop": "道具", "purifier": "净化器", "rail": "导轨", "scaffold": "脚手架",
    "tools": "工具", "tray": "托盘", "ultrasound": "超声", "washBasin": "洗手盆",
    "accessory": "配件", "arm": "手臂", "bedding": "床上用品", "book": "书",
    "cannulae": "插管", "carFrame": "车架", "catheter": "导管", "clogs": "工作鞋",
    "CT": "CT", "defibrillator": "除颤仪", "desk": "书桌", "dispenser": "分配器",
    "extractor": "抽取器", "facemask": "口罩", "facilityEquipment": "设施设备",
    "facilityFurniture": "设施家具", "fauset": "水龙头", "grid": "滤网", "headlight": "大灯",
    "hemodialysis": "血液透析", "humidifier": "加湿器", "laser": "激光", "lung": "肺部模型",
    "magazines": "杂志", "mask": "口罩", "medical": "医疗", "mirror": "镜子",
    "oximeter": "血氧仪", "pad": "垫子", "pendant": "吊塔", "phone": "电话", "ramp": "坡道",
    "robot": "机器人", "robotics": "机器人", "safetyBoard": "安全告示板", "screw": "螺丝",
    "security": "安防", "set": "套装", "shelve": "置物架", "sink": "水槽",
    "stapler": "订书机", "stethoscope": "听诊器", "stool": "凳子", "supply": "耗材",
    "thermometer": "体温计", "toilet": "马桶", "tube": "管子", "TV": "电视",
    "video": "视频设备", "warmer": "加温器", "water": "水", "wheelChair": "轮椅",
    "workshopSystem": "车间系统", "workstation": "工作站", "battery": "电池",
    "vending": "自动售货机", "recycle": "回收",
}

NAME_ZH = {
    "mug": ["马克杯", "杯子"], "cup": ["杯子", "水杯"], "glass": ["玻璃杯"],
    "bowl": ["碗"], "plate": ["盘子"], "spoon": ["勺子", "汤匙"], "fork": ["叉子"],
    "knife": ["刀"], "spatula": ["锅铲", "铲子"], "ladle": ["汤勺"], "pan": ["平底锅"],
    "pot": ["锅"], "kettle": ["水壶"], "cutting": ["案板"], "board": ["板", "案板"],
    "rolling": ["擀面杖"], "tray": ["托盘", "盘子"], "napkin": ["餐巾"],
    "apple": ["苹果"], "banana": ["香蕉"], "orange": ["橙子"], "lemon": ["柠檬"],
    "lime": ["青柠"], "peach": ["桃子"], "pear": ["梨"], "mango": ["芒果"],
    "grape": ["葡萄"], "kiwi": ["猕猴桃"], "strawberry": ["草莓"], "tomato": ["番茄"],
    "carrot": ["胡萝卜"], "potato": ["土豆"], "onion": ["洋葱"], "garlic": ["大蒜"],
    "broccoli": ["西兰花"], "corn": ["玉米"], "cucumber": ["黄瓜"], "eggplant": ["茄子"],
    "mushroom": ["蘑菇"], "avocado": ["牛油果"], "squash": ["笋瓜"], "dragon": ["火龙果"],
    "bread": ["面包"], "bagel": ["贝果"], "baguette": ["法棍"], "croissant": ["可颂"],
    "donut": ["甜甜圈"], "cake": ["蛋糕"], "cupcake": ["纸杯蛋糕"], "waffle": ["华夫饼"],
    "hot": ["热狗"], "steak": ["牛排"], "cheese": ["奶酪"], "milk": ["牛奶"],
    "yogurt": ["酸奶"], "egg": ["鸡蛋"], "chocolate": ["巧克力"], "chips": ["薯片"],
    "jam": ["果酱"], "ketchup": ["番茄酱"], "soup": ["汤"], "canned": ["罐头"],
    "coffee": ["咖啡"], "tea": ["茶"], "beer": ["啤酒"], "champagne": ["香槟"],
    "whisky": ["威士忌"], "vodka": ["伏特加"], "gin": ["金酒"], "rum": ["朗姆酒"],
    "tequila": ["龙舌兰"], "water": ["水"], "beverage": ["饮料"], "drink": ["饮料"],
    "bottle": ["瓶子"], "jar": ["罐子"], "jug": ["壶"], "thermos": ["保温杯"],
    "can": ["罐"], "vial": ["小药瓶"], "dispenser": ["分配器"],
    "fruit": ["水果"], "produce": ["水果", "生鲜", "农产品"], "vegetable": ["蔬菜"],
    "meat": ["肉"], "snack": ["零食"], "cereal": ["麦片"], "pasta": ["意面"],
    "thermometer": ["体温计", "温度计"], "thermostat": ["恒温器"],
    "eyeglasses": ["眼镜"], "glasses": ["眼镜"], "goggles": ["护目镜"],
    "extinguisher": ["灭火器"], "alarm": ["报警器"], "smoke": ["烟雾"],
    "hammer": ["锤子"], "wrench": ["扳手"], "screwdriver": ["螺丝刀"],
    "pliers": ["钳子"], "forceps": ["手术钳"], "scissors": ["剪刀"],
    "drill": ["电钻"], "saw": ["锯"], "ruler": ["尺子"], "tape": ["胶带"],
    "brush": ["刷子"], "roller": ["滚筒刷"], "funnel": ["漏斗"],
    "ladder": ["梯子"], "step": ["踏步梯"], "shelf": ["置物架"], "rack": ["货架"],
    "shelve": ["置物架"], "pallet": ["托盘"], "cart": ["推车"], "trolley": ["推车"],
    "toolbox": ["工具箱"], "workbench": ["工作台"], "cabinet": ["柜子"], "locker": ["储物柜"],
    "bin": ["垃圾箱"], "trash": ["垃圾"], "recycle": ["回收"], "waste": ["废料"],
    "crate": ["周转箱"], "barrel": ["大桶"], "drum": ["圆桶"], "bucket": ["桶"],
    "pail": ["提桶"], "box": ["盒子"], "bag": ["袋子"], "case": ["箱"],
    "monitor": ["显示器", "显示屏"], "keyboard": ["键盘"], "mouse": ["鼠标"], "computer": ["电脑"],
    "printer": ["打印机"], "phone": ["电话"], "camera": ["相机"], "screen": ["屏幕", "显示屏"],
    "tv": ["电视"], "terminal": ["终端"], "scanner": ["扫描仪"],
    "chair": ["椅子"], "stool": ["凳子"], "table": ["桌子"], "desk": ["书桌"],
    "sofa": ["沙发"], "bed": ["床"], "bench": ["长凳"],
    "lamp": ["灯"], "light": ["灯"], "lightbulb": ["灯泡"], "bulb": ["灯泡"],
    "mirror": ["镜子"], "clock": ["时钟"], "candle": ["蜡烛"],
    "soap": ["肥皂"], "sponge": ["海绵"], "towel": ["毛巾"], "mop": ["拖把"],
    "vacuum": ["吸尘器"], "fan": ["风扇"], "heater": ["取暖器"], "humidifier": ["加湿器"],
    "refrigerator": ["冰箱"], "fridge": ["冰柜"], "dishwasher": ["洗碗机"],
    "toaster": ["烤面包机"], "toilet": ["马桶"], "urinal": ["小便池"],
    "sink": ["水槽"], "basin": ["盆"], "faucet": ["水龙头"],
    "window": ["窗户"], "door": ["门"], "wall": ["墙"], "floor": ["地板"],
    "wheel": ["车轮"], "tire": ["轮胎"], "rim": ["轮毂"], "engine": ["发动机"],
    "battery": ["电池"], "forklift": ["叉车"], "jack": ["千斤顶"],
    "helmet": ["安全帽", "头盔"], "hardhat": ["安全帽"], "mask": ["口罩", "面具"],
    "gloves": ["手套"], "respirator": ["呼吸面罩"], "earplugs": ["耳塞"],
    "earmuffs": ["耳罩"], "faceshield": ["防护面罩"], "apron": ["围裙"],
    "syringe": ["注射器"], "needle": ["针头"], "scalpel": ["手术刀"],
    "stethoscope": ["听诊器"], "wheelchair": ["轮椅"],
    "defibrillator": ["除颤仪"], "hospital": ["医院"], "medicine": ["药品"],
    "insulin": ["胰岛素"], "inhaler": ["吸入器"], "bandage": ["绷带"],
    "endoscope": ["内窥镜"], "catheter": ["导管"], "retractor": ["牵开器"],
    "notebook": ["笔记本"], "pen": ["笔"], "pencil": ["铅笔"], "marker": ["记号笔"],
    "paper": ["纸"], "book": ["书"], "magazine": ["杂志"], "stapler": ["订书机"],
    "toy": ["玩具"], "robot": ["机器人"], "golf": ["高尔夫球"], "paddle": ["球拍"],
    "luggage": ["行李"], "barrier": ["路障"], "barricade": ["路障"], "fence": ["围栏"],
    "sign": ["标识"], "warning": ["警示"], "vending": ["自动售货机"],
    "oil": ["机油"], "antifreeze": ["防冻液"], "coolant": ["冷却液"],
    "grease": ["润滑脂"], "lubricant": ["润滑剂"], "paint": ["油漆"], "spray": ["喷剂"],
    "solvent": ["溶剂"], "sealant": ["密封胶"], "thinner": ["稀释剂"],
    "screw": ["螺丝"], "bolt": ["螺栓"], "nut": ["螺母"], "fuse": ["保险丝"],
    "spark": ["火花塞"], "plug": ["插头"], "socket": ["插座", "套筒"],
    "poweroutlet": ["电源插座"], "extension": ["延长线"], "powerstrip": ["插线板"],
    "surge": ["浪涌保护器"], "cable": ["电缆"], "wire": ["电线"],
    "multimeter": ["万用表"], "oscilloscope": ["示波器"], "gauge": ["仪表"],
    "scale": ["秤"], "caliper": ["卡尺"], "charger": ["充电器"],
    "compressor": ["压缩机"], "generator": ["发电机"], "pump": ["泵"],
    "valve": ["阀门"], "hose": ["软管"], "filter": ["滤芯"],
    "vise": ["台钳"], "clamp": ["夹钳"], "file": ["锉刀"], "bar": ["撬棍"],
    "ratchet": ["棘轮扳手"], "hexkey": ["内六角扳手"], "grinder": ["打磨机"],
    "polisher": ["抛光机"], "heatgun": ["热风枪"], "crane": ["吊车"],
    "hoist": ["起重机"], "lift": ["举升机"], "dolly": ["手推车"],
    "wheelbarrow": ["独轮车"], "handtruck": ["手推车"], "aid": ["急救"],
    "kit": ["套件"], "spill": ["泄漏应急"], "eyewash": ["洗眼器"],
    "microwave": ["微波炉"], "oven": ["烤箱"], "blender": ["搅拌机"],
    "extractor": ["抽取器"], "sprayer": ["喷雾器"], "squeegee": ["刮水器"],
}

CAMEL_RE = re.compile(r"[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])")
VARIANT_RE = re.compile(r"_[a-z]{1,3}\d{2}$")


def tokenize(text):
    parts = []
    for chunk in text.replace("-", "_").split("_"):
        parts.extend(CAMEL_RE.findall(chunk))
    return [p.lower() for p in parts if p]


def main():
    meta = {}
    for line in (RAW / "metadata.jsonl").open(encoding="utf-8"):
        rec = json.loads(line)
        meta[rec["asset"]] = rec
    man = {}
    for line in (RAW / "manifest.jsonl").open(encoding="utf-8"):
        rec = json.loads(line)
        man[rec["asset"]] = rec

    written = 0
    with OUT.open("w", encoding="utf-8") as fh:
        for asset in sorted(meta):
            m = meta[asset]
            d = man.get(asset, {})
            category = m["category"]
            rest = asset[len(category) + 1:] if asset.startswith(category + "_") else asset
            rest_clean = VARIANT_RE.sub("", rest)
            name_parts = tokenize(rest_clean)
            name = " ".join(name_parts) if name_parts else rest_clean
            name_tokens = set(tokenize(name))
            cat_tokens = set(tokenize(category))
            cat_tokens.add(category.lower())
            junk = re.compile(r"[a-z]{0,3}\d{2}|abc")
            name_tokens = {t for t in name_tokens if not junk.fullmatch(t)}
            cat_tokens = {t for t in cat_tokens if not junk.fullmatch(t)}
            tokens = name_tokens | cat_tokens
            zh = set()
            if CATEGORY_ZH.get(category):
                zh.add(CATEGORY_ZH[category])
            for tok in tokens:
                zh.update(NAME_ZH.get(tok, []))
            zh.discard("")
            physics = d.get("physics", {})
            record = {
                "id": asset,
                "name": name,
                "category": category,
                "category_zh": CATEGORY_ZH.get(category, ""),
                "tokens": sorted(tokens),
                "name_tokens": sorted(name_tokens),
                "zh": sorted(zh),
                "glb": m["glb"],
                "glb_url": f"{BASE_URL}/{m['glb']}",
                "thumb_url": f"{BASE_URL}/thumbs/{asset}.webp",
                "size_mb": m["size_mb"],
                "triangles": m["triangles"],
                "rigid_bodies": m.get("rigid_bodies", physics.get("rigidBodies", 0)),
                "joints": m.get("joints", physics.get("joints", 0)),
                "drives": physics.get("drives", 0),
                "collision_hulls": physics.get("collisionHulls", 0),
                "bounds": d.get("bounds"),
                "license": m.get("license", "CC-BY-4.0"),
                "source": "nvidia/simready-assets via codepawl/simready-glb",
            }
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
            written += 1

    zh_count = sum(1 for line in OUT.open(encoding="utf-8") if json.loads(line)["zh"])
    print(f"catalog: {written} assets -> {OUT}")
    print(f"assets with zh aliases: {zh_count}/{written}")


if __name__ == "__main__":
    main()
