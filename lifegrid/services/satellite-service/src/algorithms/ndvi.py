"""
============================================================
LIFEGRID – Vegetation & Water Index Computations
============================================================
All indices use L2A (surface reflectance) Sentinel-2 bands.
Input arrays must be normalized to [0, 1] reflectance.
============================================================
"""

import numpy as np

EPS = 1e-8  # Prevent division by zero


def compute_ndvi(nir: np.ndarray, red: np.ndarray) -> np.ndarray:
    """
    Normalized Difference Vegetation Index
    NDVI = (NIR - Red) / (NIR + Red)
    Range: [-1, +1]
    Healthy vegetation: > 0.4
    Stressed:           0.1 – 0.2
    Bare soil:         -0.1 – 0.1
    Water:             < -0.1
    """
    return (nir - red) / (nir + red + EPS)


def compute_ndwi(green: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """
    Normalized Difference Water Index (McFeeters 1996)
    NDWI = (Green - NIR) / (Green + NIR)
    Range: [-1, +1]
    Water bodies: > 0.3
    Drought:      < -0.3
    """
    return (green - nir) / (green + nir + EPS)


def compute_ndwi_moisture(nir: np.ndarray, swir: np.ndarray) -> np.ndarray:
    """
    NDWI for vegetation water content (Gao 1996)
    NDWI = (NIR - SWIR) / (NIR + SWIR)
    Higher values = more vegetation water content
    """
    return (nir - swir) / (nir + swir + EPS)


def compute_evi(
    nir: np.ndarray,
    red: np.ndarray,
    blue: np.ndarray,
    G: float = 2.5,
    C1: float = 6.0,
    C2: float = 7.5,
    L: float = 1.0,
) -> np.ndarray:
    """
    Enhanced Vegetation Index (Huete et al. 2002)
    EVI = G × (NIR - Red) / (NIR + C1×Red - C2×Blue + L)
    Reduces soil and atmospheric noise vs NDVI.
    Range: [-1, +1], clipped to [-1, 1]
    """
    evi = G * (nir - red) / (nir + C1 * red - C2 * blue + L + EPS)
    return np.clip(evi, -1.0, 1.0)


def compute_savi(
    nir: np.ndarray,
    red: np.ndarray,
    L: float = 0.5,
) -> np.ndarray:
    """
    Soil-Adjusted Vegetation Index (Huete 1988)
    SAVI = (1 + L) × (NIR - Red) / (NIR + Red + L)
    L = 0.5 for intermediate vegetation density
    Reduces soil brightness influence.
    """
    return (1 + L) * (nir - red) / (nir + red + L + EPS)


def compute_msavi(nir: np.ndarray, red: np.ndarray) -> np.ndarray:
    """
    Modified Soil-Adjusted Vegetation Index
    MSAVI = (2×NIR + 1 - √((2×NIR+1)² - 8×(NIR-Red))) / 2
    Self-adjusting L factor.
    """
    term = (2 * nir + 1) ** 2 - 8 * (nir - red)
    return (2 * nir + 1 - np.sqrt(np.maximum(term, 0))) / 2


def compute_nbr(nir: np.ndarray, swir2: np.ndarray) -> np.ndarray:
    """
    Normalized Burn Ratio
    NBR = (NIR - SWIR2) / (NIR + SWIR2)
    Post-fire: low NBR. Pre-fire: high NBR.
    dNBR = pre_NBR - post_NBR → burn severity
    """
    return (nir - swir2) / (nir + swir2 + EPS)


def compute_ndsi(green: np.ndarray, swir: np.ndarray) -> np.ndarray:
    """
    Normalized Difference Snow Index
    NDSI = (Green - SWIR) / (Green + SWIR)
    Snow: > 0.4
    """
    return (green - swir) / (green + swir + EPS)


def compute_all_indices(bands: dict) -> dict:
    """
    Compute all available indices from a band dictionary.
    bands: {'red': array, 'nir': array, 'green': array, 'blue': array,
            'swir1': array, 'swir2': array}
    """
    results = {}

    red   = bands.get("red")
    nir   = bands.get("nir")
    green = bands.get("green")
    blue  = bands.get("blue")
    swir1 = bands.get("swir1")
    swir2 = bands.get("swir2")

    if red is not None and nir is not None:
        ndvi = compute_ndvi(nir, red)
        results["ndvi"] = {
            "mean": float(np.nanmean(ndvi)),
            "min":  float(np.nanmin(ndvi)),
            "max":  float(np.nanmax(ndvi)),
            "std":  float(np.nanstd(ndvi)),
        }

        savi = compute_savi(nir, red)
        results["savi"] = {"mean": float(np.nanmean(savi))}

        msavi = compute_msavi(nir, red)
        results["msavi"] = {"mean": float(np.nanmean(msavi))}

    if green is not None and nir is not None:
        ndwi = compute_ndwi(green, nir)
        results["ndwi"] = {
            "mean": float(np.nanmean(ndwi)),
            "min":  float(np.nanmin(ndwi)),
            "max":  float(np.nanmax(ndwi)),
        }

    if red is not None and nir is not None and blue is not None:
        evi = compute_evi(nir, red, blue)
        results["evi"] = {"mean": float(np.nanmean(evi))}

    if nir is not None and swir1 is not None:
        ndwi_m = compute_ndwi_moisture(nir, swir1)
        results["ndwi_moisture"] = {"mean": float(np.nanmean(ndwi_m))}

    if nir is not None and swir2 is not None:
        nbr = compute_nbr(nir, swir2)
        results["nbr"] = {"mean": float(np.nanmean(nbr))}

    if green is not None and swir1 is not None:
        ndsi = compute_ndsi(green, swir1)
        results["ndsi"] = {"mean": float(np.nanmean(ndsi))}

    return results
