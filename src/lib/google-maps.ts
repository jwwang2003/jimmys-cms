export type GeocodeResult = {
    formattedAddress: string;
    lat: number;
    lng: number;
    placeId?: string;
    rawResponseJson: string;
};

function getApiKey() {
    return process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
}

export function hasGoogleMapsKey() {
    return Boolean(getApiKey());
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
    const apiKey = getApiKey();
    if (!apiKey || !address.trim()) {
        return null;
    }

    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", address);
    url.searchParams.set("key", apiKey);

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Google geocoding failed with status ${response.status}`);
    }

    const json = await response.json();
    const first = Array.isArray(json.results) ? json.results[0] : null;
    if (!first?.geometry?.location) {
        return null;
    }

    return {
        formattedAddress: first.formatted_address || address,
        lat: Number(first.geometry.location.lat),
        lng: Number(first.geometry.location.lng),
        placeId: first.place_id || undefined,
        rawResponseJson: JSON.stringify(json),
    };
}
