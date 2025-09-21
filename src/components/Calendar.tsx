'use client';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { useEffect, useMemo, useState } from 'react';

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  extendedProps?: {
    locationType?: 'GURDWARA' | 'OUTSIDE_GURDWARA';
    hallId?: string | null;
    programs?: string[]; // e.g. ["Kirtan"], ["Sukhmani Sahib"]
  };
};

export default function CalendarView() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // filters
  const [q, setQ] = useState('');
  const [showKirtan, setShowKirtan] = useState(true);
  const [showPath, setShowPath] = useState(true);
  const [locationType, setLocationType] = useState<'' | 'GURDWARA' | 'OUTSIDE_GURDWARA'>('');
  const [halls, setHalls] = useState<{ id: string; name: string }[]>([]);
  const [hallId, setHallId] = useState('');

  useEffect(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const to = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59
    ).toISOString();

    Promise.all([
      fetch(
        `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
          to
        )}`
      ).then((r) => r.json()),
      fetch('/api/halls').then((r) => r.json()),
    ])
      .then(([evs, hallsList]) => {
        setEvents(evs);
        setHalls(hallsList);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const qNorm = q.trim().toLowerCase();
    return events.filter((ev) => {
      const xp = ev.extendedProps || {};
      const progs = xp.programs || [];
      const hasKirtan = progs.some((n) => /kirtan/i.test(n));
      const hasPath = progs.some((n) => /path/i.test(n));

      const textOk =
        !qNorm ||
        ev.title.toLowerCase().includes(qNorm) ||
        progs.some((n) => n.toLowerCase().includes(qNorm));

      // category toggles: if a category is OFF, we exclude events that have it
      const catOk = (showKirtan || !hasKirtan) && (showPath || !hasPath);

      const locOk = !locationType || xp.locationType === locationType;
      const hallOk =
        !hallId || (xp.locationType === 'GURDWARA' && xp.hallId === hallId);

      return textOk && catOk && locOk && hallOk;
    });
  }, [events, q, showKirtan, showPath, locationType, hallId]);

  return (
    <section className='section'>
      <div className='card p-4 md:p-6'>
        <div className='mb-4 flex items-center justify-between gap-3'>
          <h2 className='text-lg font-semibold'>Schedule</h2>
        </div>

        {/* Filters */}
        <div className='mb-4 grid gap-3 md:grid-cols-5'>
          <input
            className='input md:col-span-2'
            placeholder='Search title or program…'
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <div className='flex items-center gap-3'>
            <label className='inline-flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                checked={showKirtan}
                onChange={(e) => setShowKirtan(e.target.checked)}
              />
              Kirtan
            </label>
            <label className='inline-flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                checked={showPath}
                onChange={(e) => setShowPath(e.target.checked)}
              />
              Path
            </label>
          </div>

          <select
            className='select'
            value={locationType}
            onChange={(e) =>
              setLocationType(e.target.value as '' | 'GURDWARA' | 'OUTSIDE_GURDWARA')
            }
          >
            <option value=''>All Locations</option>
            <option value='GURDWARA'>Hall</option>
            <option value='OUTSIDE_GURDWARA'>Home</option>
          </select>

          <select
            className='select'
            value={hallId}
            onChange={(e) => setHallId(e.target.value)}
            disabled={locationType !== 'GURDWARA'}
            title={
              locationType !== 'GURDWARA'
                ? 'Select Hall only when Location = Hall'
                : ''
            }
          >
            <option value=''>All Halls</option>
            {halls.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className='text-sm text-gray-500'>Loading calendar…</div>
        ) : (
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView='timeGridWeek'
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,timeGridWeek,timeGridDay',
            }}
            height={720}

            slotMinTime='06:00:00'
            slotMaxTime='22:00:00'

            slotLabelFormat={{
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }}
            eventTimeFormat={{
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }}
            events={filtered}
          />
        )}
      </div>
    </section>
  );
}
