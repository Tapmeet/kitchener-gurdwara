'use client';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { useEffect, useState } from 'react';

export default function CalendarView() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
    fetch(
      `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
        to
      )}`
    )
      .then((r) => r.json())
      .then(setEvents)
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className='section'>
      <div className='card p-4 md:p-6'>
        <div className='mb-4 flex items-center justify-between gap-3'>
          <h2 className='text-lg font-semibold'>Schedule</h2>
          <div className='flex items-center gap-2'>
            <span className='badge badge-muted'>Kirtan</span>
            <span className='badge badge-muted'>Path</span>
            <span className='badge badge-muted'>Hall/Home</span>
          </div>
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
            events={events}
            eventTimeFormat={{
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }}
            slotMinTime='06:00:00'
            slotMaxTime='22:00:00'
          />
        )}
      </div>
    </section>
  );
}
