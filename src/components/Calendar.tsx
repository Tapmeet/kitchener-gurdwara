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
  const [title, setTitle] = useState<string>('');
  const [view, setView] = useState<
    'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'
  >('timeGridWeek');

  const calRef = useRef<FullCalendar | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const api = () => calRef.current?.getApi();

  // ✅ swallow AbortError so rapid navigation doesn't throw
  const fetchRange = useCallback(
    async (start: Date, end: Date, signal: AbortSignal) => {
      try {
        const url = `/api/events?from=${encodeURIComponent(
          start.toISOString()
        )}&to=${encodeURIComponent(end.toISOString())}`;
        const res = await fetch(url, { signal });
        const data = await res.json().catch(() => []);
        setEvents(Array.isArray(data) ? data : []);
      } catch (err: any) {
        if (err?.name === 'AbortError' || err?.code === 20) return; // ignore expected aborts
        console.error(err);
      }
    },
    []
  );

  const goto = (dir: 'prev' | 'next' | 'today') => {
    const calendar = api();
    if (!calendar) return;
    if (dir === 'prev') calendar.prev();
    if (dir === 'next') calendar.next();
    if (dir === 'today') calendar.today();
  };

  const changeView = (v: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay') => {
    setView(v);
    api()?.changeView(v); // datesSet below will refetch and update title
  };

  return (
    <section className='section'>
      <div className='card p-4 md:p-6 relative overflow-hidden'>
        {/* Header */}
        <div className='mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
          <div>
            <h2 className='text-xl font-semibold tracking-tight'>Schedule</h2>
            <p className='text-sm text-muted-foreground'>
              {title || 'Loading…'}
            </p>
          </div>

          <div className='flex items-center gap-2'>
            {/* Nav group */}
            <div className='flex items-center rounded-2xl shadow-sm border border-black/10 overflow-hidden'>
              <button
                onClick={() => goto('prev')}
                className='px-3 py-2 hover:bg-black/5 focus:outline-none'
                aria-label='Previous'
              >
                <svg
                  width='18'
                  height='18'
                  viewBox='0 0 24 24'
                  className='opacity-70'
                >
                  <path
                    d='M15 18l-6-6 6-6'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                    strokeLinecap='round'
                  />
                </svg>
              </button>
              <button
                onClick={() => goto('today')}
                className='px-3 py-2 font-medium hover:bg-black/5 focus:outline-none'
              >
                Today
              </button>
              <button
                onClick={() => goto('next')}
                className='px-3 py-2 hover:bg-black/5 focus:outline-none'
                aria-label='Next'
              >
                <svg
                  width='18'
                  height='18'
                  viewBox='0 0 24 24'
                  className='opacity-70'
                >
                  <path
                    d='M9 6l6 6-6 6'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                    strokeLinecap='round'
                  />
                </svg>
              </button>
            </div>

            {/* Segmented view switcher */}
            <div className='flex items-center rounded-2xl shadow-sm border border-black/10 overflow-hidden'>
              {[
                { id: 'dayGridMonth', label: 'Month' },
                { id: 'timeGridWeek', label: 'Week' },
                { id: 'timeGridDay', label: 'Day' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => changeView(id as any)}
                  className={[
                    'px-3 py-2 text-sm font-medium focus:outline-none',
                    view === id
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-black/5',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Loading overlay */}
        {loading && (
          <div className='pointer-events-none absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[2px] z-10'>
            <div className='animate-spin rounded-full h-6 w-6 border-[3px] border-black/20 border-t-black/60' />
          </div>
        )}

        {/* Calendar */}
        <div className='fancy-fc'>
          <FullCalendar
            ref={calRef as any}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={view}
            headerToolbar={false}
            timeZone='local'
            height={720}
            expandRows
            stickyHeaderDates
            weekends
            nowIndicator
            allDaySlot
            dayMaxEvents
            dayMaxEventRows
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
            loading={(isLoading) => setLoading(isLoading)}
            datesSet={(arg) => {
              setTitle(arg.view.title);
              // cancel previous request and start a new one
              abortRef.current?.abort();
              const ac = new AbortController();
              abortRef.current = ac;
              fetchRange(arg.start, arg.end, ac.signal); // safe: fetchRange swallows AbortError
            }}
            events={events}
            eventContent={(arg) => {
              const progs = (arg.event.extendedProps as any)?.programs as
                | string[]
                | undefined;
              const chips = (progs ?? []).slice(0, 3);
              const more = (progs?.length ?? 0) - chips.length;
              const html = `
                <div class="fcgb-event">
                  <div class="fcgb-line">
                    <span class="fcgb-time">${arg.timeText || ''}</span>
                    <span class="fcgb-title">${arg.event.title}</span>
                  </div>
                  ${
                    chips.length
                      ? `<div class="fcgb-chips">
                          ${chips
                            .map((c) => `<span class="fcgb-chip">${c}</span>`)
                            .join('')}
                          ${
                            more > 0
                              ? `<span class="fcgb-chip fcgb-chip-more">+${more}</span>`
                              : ''
                          }
                        </div>`
                      : ''
                  }
                </div>`;
              return { html };
            }}
          />
        </div>

        {/* Theme / layout tweaks */}
        <style jsx global>{`
          .fancy-fc {
            --fc-border-color: rgba(0, 0, 0, 0.08);
            --fc-page-bg-color: transparent;
            --fc-neutral-text-color: rgb(107, 114, 128);
            --fc-button-text-color: rgb(17, 24, 39);
            --fc-today-bg-color: rgba(59, 130, 246, 0.08);
            --fc-now-indicator-color: #ef4444;
            --fc-event-text-color: white;
            --fc-event-bg-color: #2563eb;
            --fc-event-border-color: #1d4ed8;
          }
          .fancy-fc .fc {
            font-size: 0.95rem;
          }
          .fancy-fc .fc-col-header-cell-cushion {
            padding: 0.5rem 0.25rem;
            font-weight: 600;
          }
          .fancy-fc .fc-timegrid-slot-label,
          .fancy-fc .fc-daygrid-day-number {
            color: rgb(107, 114, 128);
          }

          /* Today highlight */
          .fancy-fc .fc-day-today {
            background: var(--fc-today-bg-color) !important;
          }

          /* Event styling */
          .fancy-fc .fc-event {
            border-radius: 0.75rem;
            box-shadow: 0 4px 12px rgba(2, 6, 23, 0.1);
            border: 1px solid var(--fc-event-border-color);
            /* ⛔ was: overflow: hidden;  This clipped program chips in timeGrid */
            overflow: visible;
          }
          .fancy-fc .fc-timegrid-event .fc-event {
            overflow: visible;
          } /* ensure no clipping in time view */

          .fancy-fc .fc-event:hover {
            filter: brightness(1.02);
            box-shadow: 0 6px 18px rgba(2, 6, 23, 0.16);
          }

          .fancy-fc .fcgb-event {
            padding: 0 8px;
          }
          .fancy-fc .fcgb-line {
            display: flex;
            align-items: baseline;
            gap: 6px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .fancy-fc .fcgb-time {
            font-variant-numeric: tabular-nums;
            font-weight: 600;
            opacity: 0.95;
          }
          .fancy-fc .fcgb-title {
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .fancy-fc .fcgb-chips {
            margin-top: 2px;
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
          }
          .fancy-fc .fcgb-chip {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 9999px;
            background: rgba(255, 255, 255, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.35);
            font-size: 11px;
            line-height: 16px;
            backdrop-filter: saturate(120%) blur(2px);
          }
          .fancy-fc .fcgb-chip-more {
            background: rgba(255, 255, 255, 0.14);
          }

          .fancy-fc .fc-daygrid-event {
            margin: 2px 6px;
          }
          .fancy-fc .fc-popover {
            border-radius: 0.75rem;
            border: 1px solid rgba(0, 0, 0, 0.08);
            box-shadow: 0 10px 30px rgba(2, 6, 23, 0.18);
          }

          /* Optional: tiny extra breathing room to reduce chance of visual clipping */
          .fancy-fc .fc-timegrid-event-harness {
            padding: 1px 0;
          }
        `}</style>
      </div>
    </section>
  );
}
