# OKayMaps

OKayMaps is a Boolean algebra and Karnaugh-map solving application.

## Live application

[Open OKayMaps](https://okaymaps.onrender.com/)

## Features

- Boolean expression simplification
- Truth-table solving
- Karnaugh-map visualization
- SOP, POS, and XOR/XNOR circuit representations
- Folded and unfolded MUX implementations
- Browser-based PDF export

## Requirements

- Python 3.10 or newer

## Run locally on Windows

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Then open http://localhost:8000.

You can also run `OKayMaps.bat` after installing the dependencies.

Works good
