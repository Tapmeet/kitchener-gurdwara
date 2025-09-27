'use client';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { useCallback, useRef, useState } from 'react';

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  extendedProps?: {
    locationType?: 'GURDWARA' | 'OUTSIDE_GURDWARA';
    hallId?: string | null;
    programs?: string[];
  };
};

export default function CalendarView() {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const fetchRange = useCallback(
    async (start: Date, end: Date, signal: AbortSignal) => {
      const url = `/api/events?from=${encodeURIComponent(
        start.toISOString()
      )}&to=${encodeURIComponent(end.toISOString())}`;
      const res = await fetch(url, { signal });
      const data = await res.json().catch(() => []);
      setEvents(Array.isArray(data) ? data : []);
    },
    []
  );

  return (
    <section className='section'>
      <div className='card p-4 md:p-6'>
        <div className='mb-4 flex items-center justify-between gap-3'>
          <h2 className='text-lg font-semibold'>Schedule</h2>
        </div>

        {loading && (
          <div className='text-sm text-gray-500 mb-2'>Loading calendar…</div>
        )}

        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView='timeGridWeek'
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          timeZone='local'
          height={720}
          weekends
          nowIndicator
          allDaySlot
          dayMaxEvents
          dayMaxEventRows
          // Let FullCalendar tell us when it’s fetching
          loading={(isLoading) => setLoading(isLoading)}
          // Fetch whenever the visible range changes
          datesSet={(arg) => {
            abortRef.current?.abort();
            const ac = new AbortController();
            abortRef.current = ac;
            fetchRange(arg.start, arg.end, ac.signal);
          }}
          // Provide events as a simple array (no inline fetch function)
          events={events}
          eventTimeFormat={{
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }}
          eventContent={(arg) => {
            const progs = (arg.event.extendedProps as any)?.programs as
              | string[]
              | undefined;
            const time = arg.timeText;
            const title = arg.event.title;
            const programsLine = progs && progs.length ? progs.join(', ') : '';
            return {
              html: `
                <div class="fc-event-main-frame">
                  <div class="fc-event-time">${time}</div>
                  <div class="fc-event-title">${title}</div>
                  ${
                    programsLine
                      ? `<div class="text-xs opacity-80">${programsLine}</div>`
                      : ''
                  }
                </div>
              `,
            };
          }}
        />
      </div>
    </section>
  );
}
