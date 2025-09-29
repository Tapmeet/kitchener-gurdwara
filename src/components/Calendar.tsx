'use client';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput } from '@fullcalendar/core';
import { useCallback, useEffect, useRef, useState } from 'react';

export default function CalendarView() {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<EventInput[]>([]);
  const [title, setTitle] = useState<string>('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);

  const [view, setView] = useState<
    'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'
  >('timeGridWeek');

  const calRef = useRef<FullCalendar | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const api = () => calRef.current?.getApi();

  const onEventClick = useCallback(async (arg: any) => {
    // If the user is public, the API will 403 and we’ll no-op.
    try {
      const res = await fetch(`/api/bookings/${arg.event.id}`);
      if (!res.ok) return;
      const data = await res.json();
      setDetail(data);
      setDetailOpen(true);
    } catch {
      /* swallow */
    }
  }, []);

  const formatDT = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  };

  // ✅ swallow AbortError so rapid navigation doesn't throw
  const fetchRange = useCallback(
    async (start: Date, end: Date, signal: AbortSignal) => {
      try {
        const url = `/api/events?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(
          end.toISOString()
        )}`;
        const res = await fetch(url, { signal });
        const data = await res.json().catch(() => []);
        // data is an array of EventInput; public items may include classNames: ['public-booked']
        setEvents(Array.isArray(data) ? (data as EventInput[]) : []);
      } catch (err: any) {
        if (err?.name === 'AbortError' || err?.code === 20) return;
        console.error(err);
      }
    },
    []
  );

  useEffect(() => {
    // Cleanup pending fetch on unmount
    return () => abortRef.current?.abort();
  }, []);

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
            eventClick={onEventClick}
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
              fetchRange(arg.start, arg.end, ac.signal);
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
                          ${chips.map((c) => `<span class="fcgb-chip">${c}</span>`).join('')}
                          ${more > 0 ? `<span class="fcgb-chip fcgb-chip-more">+${more}</span>` : ''}
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
            overflow: visible; /* ensure chips not clipped */
          }
          .fancy-fc .fc-timegrid-event .fc-event {
            overflow: visible;
          }

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

        {/* Public view: grey-out booked slots */}
        <style jsx global>{`
          .fancy-fc .public-booked,
          .fancy-fc .public-booked.fc-daygrid-event,
          .fancy-fc .public-booked.fc-timegrid-event {
            background: rgba(107, 114, 128, 0.18); /* gray-500 @ ~18% */
            color: rgba(31, 41, 55, 0.95); /* gray-800 */
            border-color: rgba(0, 0, 0, 0.08);
          }
          .fancy-fc .public-booked .fcgb-chip {
            display: none;
          }
          .fancy-fc .public-booked .fcgb-title {
            font-weight: 700;
          }
          .fancy-fc .public-booked .fcgb-line {
            flex-direction: column;
            align-items: flex-start; /* keeps left alignment */
          }
        `}</style>
      </div>

      {detailOpen && detail && (
        <div className='fixed inset-0 z-50 flex items-center justify-center p-4'>
          <div
            className='absolute inset-0 bg-black/40'
            onClick={() => setDetailOpen(false)}
          />
          <div className='relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl'>
            <div className='p-5 border-b border-black/10 flex items-center justify-between'>
              <h2 className='text-lg font-semibold'>Booking Details</h2>
              <button
                className='rounded-md px-3 py-1 text-sm border border-black/10 hover:bg-black/5'
                onClick={() => setDetailOpen(false)}
              >
                Close
              </button>
            </div>
            <div className='p-5 space-y-3 text-sm'>
              <div className='grid grid-cols-2 gap-3'>
                <div>
                  <div className='text-gray-500'>Title</div>
                  <div className='font-medium'>{detail.title}</div>
                </div>
                <div>
                  <div className='text-gray-500'>Location</div>
                  <div className='font-medium'>
                    {detail.locationType === 'GURDWARA'
                      ? detail.hall?.name || 'Gurdwara'
                      : detail.address || '—'}
                  </div>
                </div>
                <div>
                  <div className='text-gray-500'>Start</div>
                  <div className='font-medium'>{formatDT(detail.start)}</div>
                </div>
                <div>
                  <div className='text-gray-500'>End</div>
                  <div className='font-medium'>{formatDT(detail.end)}</div>
                </div>
                <div>
                  <div className='text-gray-500'>Attendees</div>
                  <div className='font-medium'>{detail.attendees ?? '—'}</div>
                </div>
                <div>
                  <div className='text-gray-500'>Contact</div>
                  <div className='font-medium'>
                    {detail.contactName} ({detail.contactPhone})
                    {detail.contactEmail ? ` · ${detail.contactEmail}` : ''}
                  </div>
                </div>
              </div>

              <div>
                <div className='text-gray-500 mb-1'>Programs</div>
                {Array.isArray(detail.programs) && detail.programs.length ? (
                  <div className='flex flex-wrap gap-2'>
                    {detail.programs.map((p: any) => (
                      <span
                        key={p.id}
                        className='inline-block rounded-full border px-3 py-1 text-xs'
                      >
                        {p.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div>—</div>
                )}
              </div>

              <div>
                <div className='text-gray-500 mb-1'>Assignments</div>
                {Array.isArray(detail.assignments) &&
                detail.assignments.length ? (
                  <div className='space-y-1'>
                    {detail.assignments.map((a: any) => (
                      <div key={a.id} className='flex items-center gap-2'>
                        <span className='rounded bg-black/5 px-2 py-0.5 text-xs'>
                          {a.programType?.name ?? '—'}
                        </span>
                        <span className='text-sm'>
                          {a.staff?.name ?? 'Unassigned'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>—</div>
                )}
              </div>

              {detail.notes && (
                <div>
                  <div className='text-gray-500 mb-1'>Notes</div>
                  <div className='whitespace-pre-wrap'>{detail.notes}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
