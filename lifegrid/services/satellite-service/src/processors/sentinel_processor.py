"""Sentinel-1/2 data processor stub."""

class SentinelProcessor:
    """
    Processes Sentinel-1 (SAR) and Sentinel-2 (optical) products.
    Source: Copernicus Open Access Hub / AWS S3 (sentinel-s2-l2a)
    Formats: SAFE, GeoTIFF, COG (Cloud-Optimized GeoTIFF)
    """
    def process(self, data_url: str, bbox: dict) -> dict:
        return {"status": "processed", "source": "SENTINEL"}
