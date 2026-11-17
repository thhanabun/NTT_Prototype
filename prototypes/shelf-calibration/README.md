# FAST Store Map Camera

Local camera and store-map prototype embedded in Admin at `/admin/cameras/*`.

Start the main API and Web App as usual, then in a separate terminal from the repository root run:

```powershell
.\.venv-vision\Scripts\python.exe -I prototypes/shelf-calibration/server.py
```

Open Admin → กล้อง. The service listens on `127.0.0.1:8090`; YOLO assets come from the repo's `data/vision` directory. The map and calibration are stored in this browser's local storage. This prototype is local-only; it does not upload camera video or write map/presence data to AWS.
