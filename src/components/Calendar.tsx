'use client';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
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

  // ✅ mobile mode + selected date for the native date picker
  const [isMobile, setIsMobile] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>('');

  const calRef = useRef<FullCalendar | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const api = () => calRef.current?.getApi();

  // Mobile detection (matches Tailwind md breakpoint ~768px)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Switch views automatically based on screen size
  useEffect(() => {
    const cal = api();
    if (!cal) return;
    if (isMobile) {
      setView('timeGridWeek'); // keep state consistent for desktop return
      cal.changeView('listDay'); // show day list on phones
    } else {
      cal.changeView('timeGridWeek'); // your default desktop view
    }
  }, [isMobile]);

  const onEventClick = useCallback(async (arg: any) => {
    const kind = arg.event.extendedProps?.kind;

    // Space booking: use event data directly, no extra fetch
    if (kind === 'space') {
      const detail = {
        kind: 'space',
        title: arg.event.title,
        description: arg.event.extendedProps?.description ?? null,
        locationType: arg.event.extendedProps?.locationType ?? 'GURDWARA',
        address: arg.event.extendedProps?.address ?? null,
        hallName: arg.event.extendedProps?.hallName ?? null,
        blocksHall: !!arg.event.extendedProps?.blocksHall,
        recurrence: arg.event.extendedProps?.recurrence ?? 'ONCE',
        interval: arg.event.extendedProps?.interval ?? 1,
        start: arg.event.start?.toISOString() ?? null,
        end: arg.event.end?.toISOString() ?? null,
      };
      setDetail(detail);
      setDetailOpen(true);
      return;
    }

    // Normal booking (supports Sehaj split ids)
    try {
      const bookingId =
        arg.event.extendedProps?.bookingId ??
        String(arg.event.id).split(':')[0];

      const res = await fetch(`/api/bookings/${bookingId}`);

      if (!res.ok) return;

      const data = await res.json();

      // attach which segment was clicked (optional but useful)
      const sehajSlot = arg.event.extendedProps?.sehajSlot ?? null;
      const programNames = arg.event.extendedProps?.programNames ?? null;

      setDetail({ ...data, sehajSlot, programNames });
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

  const describeSpaceRecurrence = (detail: any) => {
    const freq = detail.recurrence ?? 'ONCE';
    const interval = detail.interval ?? 1;
    const every = interval === 1 ? 'Every' : `Every ${interval}`;
    switch (freq) {
      case 'ONCE':
        return 'One-time';
      case 'DAILY':
        return `${every} day`;
      case 'WEEKLY':
        return `${every} week`;
      case 'MONTHLY':
        return `${every} month`;
      case 'YEARLY':
        return `${every} year`;
      default:
        return 'One-time';
    }
  };

  const toDateInputValue = (d: Date) => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  // ✅ swallow AbortError so rapid navigation doesn't throw
  const fetchRange = useCallback(
    async (start: Date, end: Date, signal: AbortSignal) => {
      try {
        const url = `/api/events?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`;
        const res = await fetch(url, { signal });
        const data = await res.json().catch(() => []);
        setEvents(Array.isArray(data) ? (data as EventInput[]) : []);
      } catch (err: any) {
        if (err?.name === 'AbortError' || err?.code === 20) return;
        console.error(err);
      }
    },
    []
  );

  useEffect(() => {
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
    api()?.changeView(v);
  };

  const onPickDate = (val: string) => {
    setSelectedDate(val);
    if (val) api()?.gotoDate(val); // jumps far ahead easily on mobile
  };

  const listLabel = (ev: any) => {
    const start: Date = ev.start!;
    const end: Date | null = ev.end ?? null;

    const fmtHM = (d: Date) =>
      d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    const fmtMD = (d: Date) =>
      d.toLocaleDateString([], { month: 'short', day: 'numeric' });

    if (!end) return `${fmtHM(start)}`;

    const multiDay =
      start.getFullYear() !== end.getFullYear() ||
      start.getMonth() !== end.getMonth() ||
      start.getDate() !== end.getDate();

    if (multiDay) {
      const days = Math.max(
        1,
        Math.round((end.getTime() - start.getTime()) / 86400000)
      );
      return `${fmtMD(start)} ${fmtHM(start)} → ${fmtMD(end)} ${fmtHM(end)} (${days} day${days > 1 ? 's' : ''})`;
    }
    return `${fmtHM(start)} – ${fmtHM(end)}`;
  };

  return (
    <section className='section'>
      <div className='card p-4 md:p-6 relative'>
        {/* Header */}
        <div className='mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
          <div>
            <h2 className='text-xl font-semibold tracking-tight'>Schedule</h2>
            <p className='text-sm text-muted-foreground'>
              {title || 'Loading…'}
            </p>
          </div>

          {/* Controls */}
          {isMobile ? (
            <div className='flex items-center gap-2'>
              {/* Day nav */}
              <div className='flex items-center rounded-2xl shadow-sm border border-black/10 overflow-hidden'>
                <button
                  onClick={() => goto('prev')}
                  className='px-3 py-2 hover:bg-black/5'
                  aria-label='Previous day'
                >
                  ‹
                </button>
                <button
                  onClick={() => goto('today')}
                  className='px-3 py-2 font-medium hover:bg-black/5'
                >
                  Today
                </button>
                <button
                  onClick={() => goto('next')}
                  className='px-3 py-2 hover:bg-black/5'
                  aria-label='Next day'
                >
                  ›
                </button>
              </div>

              {/* Fast jump: native calendar picker (great on phones) */}
              <label className='flex items-center gap-2 rounded-2xl border border-black/10 px-3 py-2 text-sm bg-white'>
                <span className='opacity-70'>Jump</span>
                <input
                  type='date'
                  className='outline-none'
                  value={selectedDate}
                  onChange={(e) => onPickDate(e.target.value)}
                />
              </label>
            </div>
          ) : (
            <div className='flex items-center gap-2'>
              {/* Nav group */}
              <div className='flex items-center rounded-2xl shadow-sm border border-black/10 overflow-hidden'>
                <button
                  onClick={() => goto('prev')}
                  className='px-3 py-2 hover:bg-black/5'
                  aria-label='Previous'
                >
                  ‹
                </button>
                <button
                  onClick={() => goto('today')}
                  className='px-3 py-2 font-medium hover:bg-black/5'
                >
                  Today
                </button>
                <button
                  onClick={() => goto('next')}
                  className='px-3 py-2 hover:bg-black/5'
                  aria-label='Next'
                >
                  ›
                </button>
              </div>

              {/* Segmented view switcher (desktop only) */}
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
          )}
        </div>

        {/* Loading overlay */}
        {loading && (
          <div className='pointer-events-none absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[2px] z-10'>
            <div className='animate-spin rounded-full h-6 w-6 border-[3px] border-black/20 border-t-black/60' />
          </div>
        )}

        {/* Calendar */}
        <div className='mt-2 mb-3 space-y-2'>
          {/* Gurdwara (green) */}
          <div className='flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900'>
            <span
              className='mt-0.5 inline-flex h-3 w-3 flex-shrink-0 rounded-sm bg-emerald-400 shadow-inner'
              aria-hidden='true'
            />
            <div>
              <span className='block font-semibold'>
                Special programs from Gurdwara Sahib
              </span>
              <span className='block'>
                Look for the <span className='font-semibold'>green blocks</span>{' '}
                in the calendar and tap/click them to see full details of GTSA
                programs.
              </span>
            </div>
          </div>

          {/* Outside Gurdwara (purple) */}
          <div className='flex items-start gap-2 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-900'>
            <span
              className='mt-0.5 inline-flex h-3 w-3 flex-shrink-0 rounded-sm bg-purple-400 shadow-inner'
              aria-hidden='true'
            />
            <div>
              <span className='block font-semibold'>
                Programs outside Gurdwara Sahib
              </span>
              <span className='block'>
                Look for the{' '}
                <span className='font-semibold'>purple blocks</span> in the
                calendar—these are programs happening outside GTSA. Tap/click to
                see the location details.
              </span>
            </div>
          </div>
        </div>

        <div className='fancy-fc'>
          <FullCalendar
            ref={calRef as any}
            plugins={[
              dayGridPlugin,
              timeGridPlugin,
              listPlugin,
              interactionPlugin,
            ]}
            initialView={'timeGridWeek'} // desktop default; we switch to 'listDay' in effect on phones
            headerToolbar={false}
            timeZone='local'
            height={isMobile ? 'auto' : 720} // list view should size to content on mobile
            contentHeight={isMobile ? 'auto' : undefined}
            expandRows
            stickyHeaderDates
            weekends
            nowIndicator
            allDaySlot
            dayMaxEvents
            dayMaxEventRows
            eventDidMount={(info) => {
              // show hand cursor and native tooltip
              info.el.classList.add('cursor-pointer');
              if (!info.el.getAttribute('title')) {
                info.el.setAttribute('title', 'Click to see more details');
              }
            }}
            eventClick={onEventClick}
            loading={(isLoading) => setLoading(isLoading)}
            datesSet={(arg) => {
              setTitle(arg.view.title);
              if (isMobile) setSelectedDate(toDateInputValue(arg.start));
              abortRef.current?.abort();
              const ac = new AbortController();
              abortRef.current = ac;
              fetchRange(arg.start, arg.end, ac.signal);
            }}
            events={events}
            listDayFormat={{ weekday: 'long', month: 'short', day: 'numeric' }}
            listDaySideFormat={false} // hides the tiny right-side date in list headers
            eventContent={(arg) => {
              // Helpers
              const fmtHM = (d: Date) =>
                d.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                });
              const fmtMD = (d: Date) =>
                d.toLocaleDateString([], { month: 'short', day: 'numeric' });

              const start = arg.event.start!;
              const end = arg.event.end ?? null;
              const isMultiDay =
                !!end &&
                (end.getFullYear() !== start.getFullYear() ||
                  end.getMonth() !== start.getMonth() ||
                  end.getDate() !== start.getDate());

              // 1) List view (mobile): use your custom label
              if (arg.view.type.startsWith('list')) {
                const days = end
                  ? Math.max(
                      1,
                      Math.round((end.getTime() - start.getTime()) / 86400000)
                    )
                  : 0;
                const label = !end
                  ? `${fmtHM(start)}`
                  : isMultiDay
                    ? `${fmtMD(start)} ${fmtHM(start)} → ${fmtMD(end)} ${fmtHM(end)} (${days} day${days > 1 ? 's' : ''})`
                    : `${fmtHM(start)} – ${fmtHM(end)}`;

                return {
                  html: `
        <div class="fcgb-list">
          <div class="fcgb-time">${label}</div>
          <div class="fcgb-title">${arg.event.title}</div>
        </div>`,
                };
              }

              // 2) Month / Week / Day GRID views
              let timeLabel = '';
              if (isMultiDay) {
                // Only show the full range on the first segment (prevents repeating on each day)
                if ((arg as any).isStart) {
                  const days = Math.max(
                    1,
                    Math.round((end!.getTime() - start.getTime()) / 86400000)
                  );
                  timeLabel = `(${days} day${days > 1 ? 's' : ''})`;
                } else {
                  // Middle or ending segments: no time text; keep title only
                  timeLabel = '';
                }
              } else {
                // Same-day event
                timeLabel = end
                  ? `${fmtHM(start)} – ${fmtHM(end)}`
                  : `${fmtHM(start)}`;
              }

              // (Keep your chips UI if you want on grid; you can remove chips if you prefer a cleaner month view)
              const progs = ((arg.event.extendedProps as any)?.programs ??
                (arg.event.extendedProps as any)?.programNames) as
                | string[]
                | undefined;

              const chips = (progs ?? []).slice(0, 3);
              const more = (progs?.length ?? 0) - chips.length;

              const html = `
    <div class="fcgb-event">
      <div class="fcgb-line">
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
            --fc-event-text-color: rgb(17, 24, 39); /* dark text */
            /* fallback if no custom class hits */
            --fc-event-bg-color: #e0ebff;
            --fc-event-border-color: #bfdbfe;
          }

          /* 🎨 Event palettes (admin + public) */

          /* Normal booking, CONFIRMED */
          .fancy-fc .fc-event.booking.booking-confirmed {
            background-color: #e0ebff; /* soft blue */
            border-color: #bfdbfe;
          }

          /* Normal booking, PENDING */
          .fancy-fc .fc-event.booking.booking-pending {
            background-color: #fef3c7; /* soft amber */
            border-color: #fde68a;
          }

          /* Space bookings (recurring blocks, etc.) */
          .fancy-fc .fc-event.space-booking {
            background-color: #dcfce7; /* soft green */
            border-color: #bbf7d0;
          }

          /* Space bookings outside Gurdwara */
          .fancy-fc .fc-event.space-booking.space-outside {
            background-color: #f3e8ff; /* soft purple */
            border-color: #ddd6fe;
          }

          /* Grid views */
          .fancy-fc .fc {
            font-size: 0.95rem;
          }
          .fancy-fc .fc-col-header-cell-cushion {
            padding: 0.5rem 0.25rem;
            font-weight: 600;
          }
          .fancy-fc .fc-day-today {
            background: var(--fc-today-bg-color) !important;
          }
          .fancy-fc .fc-event {
            border-radius: 0.75rem;
            box-shadow: 0 4px 12px rgba(2, 6, 23, 0.1);
            background-color: var(--fc-event-border-color);
            overflow: visible;
          }
          .fancy-fc .fc-event:hover {
            filter: brightness(1.02);
            box-shadow: 0 6px 18px rgba(2, 6, 23, 0.16);
          }
          .fancy-fc .fc-daygrid-event {
            margin: 2px 6px;
          }
          .fancy-fc .fc-popover {
            z-index: 60 !important;
            box-shadow: 0 10px 30px rgba(2, 6, 23, 0.18);
            border: 1px solid rgba(0, 0, 0, 0.08);
            border-radius: 0.75rem;
            background-color: #fff !important;
            backdrop-filter: none !important;
          }

          /* Custom content (grid) */
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
            flex-direction: column;
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

          /* List view (mobile) */
          .fancy-fc .fc-list-empty {
            padding: 1rem;
            color: rgb(107, 114, 128);
          }
          .fancy-fc .fc-list,
          .fancy-fc .fc-list-table {
            border-radius: 0.75rem;
            overflow: hidden;
            border: 1px solid rgba(0, 0, 0, 0.08);
          }
          .fancy-fc .fc-list-day-cushion {
            font-weight: 600;
          }
          .fancy-fc .fcgb-list {
            display: flex;
            gap: 8px;
            align-items: baseline;
          }
          .fancy-fc .fcgb-list .fcgb-time {
            font-variant-numeric: tabular-nums;
            font-weight: 600;
            opacity: 0.95;
          }
          .fancy-fc .fcgb-list .fcgb-title {
            font-weight: 600;
          }

          /* Public greyed events stay readable */
          .fancy-fc .public-booked,
          .fancy-fc .public-booked.fc-daygrid-event,
          .fancy-fc .public-booked.fc-timegrid-event {
            background: rgba(107, 114, 128, 0.18);
            color: rgba(31, 41, 55, 0.95) !important;
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
            align-items: flex-start;
          }
          /* If an event row has only title (no time label), keep spacing tidy */
          .fancy-fc .fcgb-line:has(.fcgb-title):not(:has(.fcgb-time)) {
            gap: 4px;
          }
          .fancy-fc .fc-daygrid-event .fcgb-title {
            white-space: normal; /* allow wrap */
            line-height: 1.2;
          }

          /* Mobile: hide FullCalendar's built-in time column in LIST view.
   We render our own correct label via eventContent. */
          @media (max-width: 768px) {
            .fancy-fc .fc-list-event-time {
              display: none !important;
            }
            /* Optional: keep rows cleaner on small screens */
            .fancy-fc .fc-list-event-dot {
              opacity: 0.7;
            }
            .fancy-fc .fc-list-event-title {
              white-space: normal;
            }
          }
        `}</style>
      </div>

      {/* Detail Modal */}
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
              {detail.kind === 'space' ? (
                <>
                  <div className='grid grid-cols-2 gap-3'>
                    <div>
                      <div className='text-gray-500'>Title</div>
                      <div className='font-medium'>{detail.title}</div>
                    </div>
                    <div>
                      <div className='text-gray-500'>Location</div>
                      <div className='font-medium'>
                        {detail.locationType === 'OUTSIDE_GURDWARA'
                          ? detail.address || 'Outside (no address)'
                          : detail.hallName
                            ? detail.hallName
                            : 'Gurdwara'}
                      </div>
                    </div>
                    <div>
                      <div className='text-gray-500'>Start</div>
                      <div className='font-medium'>
                        {detail.start ? formatDT(detail.start) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className='text-gray-500'>End</div>
                      <div className='font-medium'>
                        {detail.end ? formatDT(detail.end) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className='text-gray-500'>Recurrence</div>
                      <div className='font-medium'>
                        {describeSpaceRecurrence(detail)}
                      </div>
                    </div>
                    <div>
                      <div className='text-gray-500'>Reserves hall?</div>
                      <div className='font-medium'>
                        {detail.blocksHall ? 'Yes' : 'No'}
                      </div>
                    </div>
                  </div>

                  {detail.description && (
                    <div>
                      <div className='text-gray-500 mb-1'>Description</div>
                      <div className='whitespace-pre-wrap'>
                        {detail.description}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* existing booking detail layout */}
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
                      <div className='font-medium'>
                        {formatDT(detail.start)}
                      </div>
                    </div>
                    <div>
                      <div className='text-gray-500'>End</div>
                      <div className='font-medium'>{formatDT(detail.end)}</div>
                    </div>
                    <div>
                      <div className='text-gray-500'>Attendees</div>
                      <div className='font-medium'>
                        {detail.attendees ?? '—'}
                      </div>
                    </div>
                    <div>
                      <div className='text-gray-500'>Contact</div>
                      <div className='font-medium'>
                        {detail.contactName} ({detail.contactPhone})
                        {detail.contactEmail ? ` · ${detail.contactEmail}` : ''}
                      </div>
                    </div>
                  </div>

                  {detail.sehajSlot && (
                    <div>
                      <div className='text-gray-500 mb-1'>Clicked segment</div>
                      <div className='font-medium'>
                        {detail.sehajSlot === 'start'
                          ? 'Start'
                          : detail.sehajSlot === 'endPath'
                            ? 'Path (last hour)'
                            : detail.sehajSlot === 'endKirtan'
                              ? 'Kirtan (final hour)'
                              : detail.sehajSlot}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className='text-gray-500 mb-1'>Programs</div>
                    {Array.isArray(detail.programs) &&
                    detail.programs.length ? (
                      <div className='flex flex-wrap gap-2'>
                        {detail.programs.map((p: any) => (
                          <span
                            key={p.id}
                            className='rounded bg-black/5 px-2 py-0.5 text-xs'
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
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
