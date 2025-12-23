'use client';

import { useState } from 'react';
import AddressAutocomplete from '@/components/AddressAutocomplete';

type HallOption = {
  id: string;
  name: string;
};

type Props = {
  halls: HallOption[];
  defaultLocationType?: 'GURDWARA' | 'OUTSIDE_GURDWARA';
};

export default function SpaceBookingLocationFields({
  halls,
  defaultLocationType = 'GURDWARA',
}: Props) {
  const [locationType, setLocationType] = useState<
    'GURDWARA' | 'OUTSIDE_GURDWARA'
  >(defaultLocationType);

  return (
    <>
      <div className='space-y-2'>
        <label className='block text-sm font-medium'>Location type</label>
        <select
          name='locationType'
          value={locationType}
          onChange={(e) =>
            setLocationType(
              (e.target.value as any) === 'OUTSIDE_GURDWARA'
                ? 'OUTSIDE_GURDWARA'
                : 'GURDWARA'
            )
          }
          className='w-full rounded-md border border-black/10 px-3 py-2 text-sm'
        >
          <option value='GURDWARA'>Gurdwara</option>
          <option value='OUTSIDE_GURDWARA'>Outside Gurdwara</option>
        </select>
        <p className='text-xs text-gray-500'>
          Choose <b>Outside Gurdwara</b> if this program happens at another
          location. It will show in the calendar with a different color.
        </p>
      </div>

      {locationType === 'OUTSIDE_GURDWARA' ? (
        <div className='space-y-2'>
          <label className='block text-sm font-medium'>Outside location</label>
          <AddressAutocomplete
            name='address'
            required
            placeholder='Search the outside location address…'
            className='w-full rounded-md border border-black/10 px-3 py-2 text-sm'
          />
          <p className='text-xs text-gray-500'>
            Tip: pick a suggestion so the address is consistent.
          </p>
        </div>
      ) : (
        <div className='space-y-2'>
          <label className='block text-sm font-medium'>Hall reservation</label>
          <div className='space-y-2 text-sm'>
            <label className='flex items-center gap-2'>
              <input
                type='checkbox'
                name='blocksHall'
                defaultChecked
                className='rounded border-black/20'
              />
              <span>Reserve a specific hall for this time slot</span>
            </label>
            <select
              name='hallId'
              className='mt-1 w-full rounded-md border border-black/10 px-3 py-2 text-sm'
              defaultValue=''
            >
              <option value=''>Choose hall…</option>
              {halls.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
            <p className='text-xs text-gray-500'>
              If you uncheck “Reserve hall”, this will still appear on the
              calendar but all halls remain available for normal bookings.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
