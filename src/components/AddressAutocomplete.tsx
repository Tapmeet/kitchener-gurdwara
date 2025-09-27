'use client';

import { Loader } from '@googlemaps/js-api-loader';
import { useEffect, useMemo, useRef, useState } from 'react';

type Props = {
  name?: string; // form field name for full address
  placeholder?: string;
  required?: boolean;
};

export default function AddressAutocomplete({
  name = 'address',
  placeholder = 'Please use auto complete and add address like 26 Periwinkle St, Kitchener, ON N2E 4C7, Canada',
  required,
}: Props) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // extracted info (optional hidden fields)
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [postal, setPostal] = useState('');
  const [locality, setLocality] = useState('');
  const [province, setProvince] = useState('');
  const [country, setCountry] = useState('');

  const loader = useMemo(
    () => new Loader({ apiKey, libraries: ['places'] }),
    [apiKey]
  );

  useEffect(() => {
    // Always render the input immediately.
    // Then progressively enhance with Places if key loads.
    let cleanup = () => {};
    (async () => {
      if (!apiKey) {
        setReady(false);
        setError('No Google API key set');
        return;
      }
      try {
        await loader.load();
        if (!inputRef.current || !(window as any).google) return;

        const ac = new google.maps.places.Autocomplete(inputRef.current!, {
          fields: ['address_components', 'formatted_address', 'geometry'],
          componentRestrictions: { country: ['ca'] }, // Canada only
        });

        const listener = ac.addListener('place_changed', () => {
          const place = ac.getPlace();
          if (!place) return;

          if (place.formatted_address) setValue(place.formatted_address);

          const loc = place.geometry?.location;
          if (loc) {
            setLat(String(loc.lat()));
            setLng(String(loc.lng()));
          } else {
            setLat('');
            setLng('');
          }

          const comps = place.address_components || [];
          const get = (type: string) =>
            comps.find((c) => c.types.includes(type))?.long_name || '';

          setPostal(get('postal_code'));
          setLocality(
            get('locality') || get('sublocality') || get('postal_town')
          );
          setProvince(get('administrative_area_level_1'));
          setCountry(get('country'));
        });

        setReady(true);
        setError(null);
        cleanup = () => google.maps.event.removeListener(listener);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e: any) {
        setReady(false);
        setError('Failed to load Places');
      }
    })();

    return () => cleanup();
  }, [loader, apiKey]);

  // When the field appears, focus it (nice UX cue)
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className='space-y-1'>
      <input
        ref={inputRef}
        className='input'
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required={required}
        autoComplete='off'
        inputMode='text'
      />
      {/* Hidden fields you can optionally persist server-side */}
      <input type='hidden' name='address_lat' value={lat} />
      <input type='hidden' name='address_lng' value={lng} />
      <input type='hidden' name='address_postal' value={postal} />
      <input type='hidden' name='address_city' value={locality} />
      <input type='hidden' name='address_province' value={province} />
      <input type='hidden' name='address_country' value={country} />

      {/* Tiny helper if key missing or script failed — input still works */}
      {!ready && (
        <p className='text-xs text-gray-500'>
          {error
            ? 'Autocomplete unavailable — plain input enabled.'
            : 'Loading suggestions…'}
        </p>
      )}
    </div>
  );
}
