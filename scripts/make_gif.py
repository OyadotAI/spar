import os
from PIL import Image

def generate_gif():
    images = [
        "docs/assets/screenshot-jobs.png",
        "docs/assets/screenshot-visual.png",
        "docs/assets/screenshot-script.png",
        "docs/assets/screenshot-console.png",
        "docs/assets/screenshot-monitoring.png",
    ]
    
    frames = []
    # Target 1200x770 for sharp yet compact GIF
    target_size = (1200, 771)
    
    for img_path in images:
        if os.path.exists(img_path):
            img = Image.open(img_path).convert("RGBA")
            img = img.resize(target_size, Image.Resampling.LANCZOS)
            # Convert to P mode with palette for clean GIF compression
            p_img = img.convert("RGB").quantize(colors=256, method=Image.Resampling.LANCZOS)
            frames.append(p_img)
            
    if frames:
        # 2200ms per slide, infinite loop
        frames[0].save(
            "docs/assets/demo.gif",
            save_all=True,
            append_images=frames[1:],
            duration=2200,
            loop=0,
            optimize=True
        )
        print("Generated docs/assets/demo.gif successfully!")

if __name__ == "__main__":
    generate_gif()
