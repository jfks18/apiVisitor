'use client';
import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';

interface Visitor {
  visitorsID: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  purpose: string;
  faculty_to_visit: string[];
  logid: number;
  timeIn: string | null;
  timeOut: string | null;
  logCreatedAt: string;
}

const Table = () => {
  console.log('Table mounted');
  const [data, setData] = useState<Visitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pendingDateFrom, setPendingDateFrom] = useState('');
  const [pendingDateTo, setPendingDateTo] = useState('');
  const [dateError, setDateError] = useState('');
  const [filter, setFilter] = useState<'today' | 'month' | 'range'>('today');
  const [showActions, setShowActions] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);
  const [rangeFetchTrigger, setRangeFetchTrigger] = useState(0);
  const router = useRouter();
  const tableRef = useRef<HTMLTableElement>(null);

  // Helper to get today's date in yyyy-mm-dd
  const todayStr = new Date().toISOString().slice(0, 10);
  // Helper to get first and last day of this month
  const monthStartStr = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const monthEndStr = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);

  // Helper to format time as AM/PM
  function formatTime(timeStr: string | null) {
    if (!timeStr) return '-';
    // Handles HH:mm:ss or HH:mm
    const [h, m, s] = timeStr.split(':');
    let hour = parseInt(h, 10);
    const minute = m;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return `${hour}:${minute} ${ampm}`;
  }

  useEffect(() => {
    console.log('useEffect triggered', { filter, todayStr, monthStartStr, monthEndStr, rangeFetchTrigger });
    let url = 'https://4d29-182-255-40-183.ngrok-free.app/api/visitors';
    if (filter === 'today') {
      url += `?createdAt=${todayStr}`;
    } else if (filter === 'month') {
      url += `?startDate=${monthStartStr}&endDate=${monthEndStr}`;
    } else if (filter === 'range') {
      if (dateFrom && dateTo) {
        url += `?startDate=${dateFrom}&endDate=${dateTo}`;
      } else {
        return; // Don't fetch if dates are missing
      }
    }
    console.log('Fetching:', url); // Log the API URL being fetched
    setLoading(true);
    setError(null);
    fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    })
      .then(async res => {
        const text = await res.text();
        if (!res.ok) {
          throw new Error('Failed to fetch: ' + text);
        }
        // Check if response is HTML (ngrok error page or similar)
        if (text.trim().startsWith('<!DOCTYPE html>')) {
          throw new Error('Received HTML instead of JSON. The backend may be down or the URL is incorrect.');
        }
        try {
          return JSON.parse(text);
        } catch (e) {
          console.error('Non-JSON response:', text);
          throw new Error('Response is not valid JSON: ' + text);
        }
      })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [filter, todayStr, monthStartStr, monthEndStr, rangeFetchTrigger]);

  const handleRangeClick = () => {
    setPendingDateFrom(dateFrom);
    setPendingDateTo(dateTo);
    setShowModal(true);
    setDateError('');
  };

  const handleModalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingDateFrom || !pendingDateTo) {
      setDateError('Please select both dates.');
      return;
    }
    if (pendingDateFrom > pendingDateTo) {
      setDateError('Please insert not before the first date');
      return;
    }
    setShowModal(false);
    setDateFrom(pendingDateFrom);
    setDateTo(pendingDateTo);
    setFilter('range');
    setRangeFetchTrigger(t => t + 1); // Always trigger fetch
  };

  const handleExportExcel = () => {
    setShowActions(false);
    setTimeout(() => {
      // Prepare data for Excel (exclude Actions column)
      const exportData = data.map(row => ({
        'Visitor ID': row.visitorsID,
        'Name': `${row.first_name} ${row.middle_name} ${row.last_name}`.replace(/  +/g, ' ').trim(),
        'Purpose': row.purpose,
        'Faculty to Visit': Array.isArray(row.faculty_to_visit) ? row.faculty_to_visit.join(', ') : row.faculty_to_visit,
        'Time In': formatTime(row.timeIn),
        'Time Out': formatTime(row.timeOut),
        'Log Date': row.logCreatedAt ? new Date(row.logCreatedAt).toLocaleString() : '-'
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Visitors');
      XLSX.writeFile(wb, 'visitors_report.xlsx');
      setShowActions(true);
    }, 100);
  };

  const handleExportPDF = async () => {
    setShowActions(false);
    setTimeout(async () => {
      const jsPDF = (await import('jspdf')).default;
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF();
      const exportData = data.map(row => [
        row.visitorsID,
        `${row.first_name} ${row.middle_name} ${row.last_name}`.replace(/  +/g, ' ').trim(),
        row.purpose,
        Array.isArray(row.faculty_to_visit) ? row.faculty_to_visit.join(', ') : row.faculty_to_visit,
        formatTime(row.timeIn),
        formatTime(row.timeOut),
        row.logCreatedAt ? new Date(row.logCreatedAt).toLocaleString() : '-'
      ]);
      autoTable(doc, {
        head: [[
          'Visitor ID', 'Name', 'Purpose', 'Faculty to Visit', 'Time In', 'Time Out', 'Log Date'
        ]],
        body: exportData
      });
      doc.save('visitors_report.pdf');
      setShowActions(true);
    }, 100);
  };

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, position: 'relative' }}>
        <button className="btn btn-primary" onClick={() => setFilter('today')}>Today</button>
        <button className="btn btn-primary" onClick={() => setFilter('month')}>Month</button>
        <button className="btn btn-secondary" onClick={handleRangeClick}>Select Date</button>
        <div style={{ position: 'relative' }}>
          <button
            className="btn btn-secondary dropdown-toggle"
            type="button"
            onClick={() => setShowDropdown((v) => !v)}
            aria-expanded={showDropdown}
          >
            Report
          </button>
          {showDropdown && (
            <div
              className="dropdown-menu show"
              style={{ display: 'block', position: 'absolute', zIndex: 10 }}
            >
              <button className="dropdown-item" onClick={() => { setShowDropdown(false); handleExportExcel(); }}>
                Export Excel
              </button>
              <button className="dropdown-item" onClick={() => { setShowDropdown(false); handleExportPDF(); }}>
                Export PDF
              </button>
            </div>
          )}
        </div>
      </div>
      {/* Modal for date range selection */}
      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.3)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', padding: 24, borderRadius: 8, minWidth: 300 }}>
            <h5>Select Date Range</h5>
            <form onSubmit={handleModalSubmit}>
              <div className="mb-2">
                <label>From:</label>
                <input type="date" className="form-control" value={pendingDateFrom} onChange={e => setPendingDateFrom(e.target.value)} max={pendingDateTo || undefined} />
              </div>
              <div className="mb-2">
                <label>To:</label>
                <input type="date" className="form-control" value={pendingDateTo} onChange={e => setPendingDateTo(e.target.value)} min={pendingDateFrom || undefined} />
              </div>
              {dateError && <div className="alert alert-danger py-1 my-2">{dateError}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="submit" className="btn btn-success">Apply</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="table-responsive">
        {loading && <div>Loading...</div>}
        {error && <div className="alert alert-danger">{error}</div>}
        {!loading && !error && (
          <table ref={tableRef} className="table table-striped table-bordered align-middle">
            <thead className="table-dark">
              <tr>
                <th>Visitor ID</th>
                <th>Name</th>
                <th>Purpose</th>
                <th>Faculty to Visit</th>
                <th>Time In</th>
                <th>Time Out</th>
                <th>Log Date</th>
                {showActions && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.logid}>
                  <td>{row.visitorsID}</td>
                  <td>{`${row.first_name} ${row.middle_name} ${row.last_name}`.replace(/  +/g, ' ').trim()}</td>
                  <td>{row.purpose}</td>
                  <td>
                    {Array.isArray(row.faculty_to_visit)
                      ? row.faculty_to_visit.join(', ')
                      : row.faculty_to_visit}
                  </td>
                  <td>{formatTime(row.timeIn)}</td>
                  <td>{formatTime(row.timeOut)}</td>
                  <td>{row.logCreatedAt ? new Date(row.logCreatedAt).toLocaleString() : '-'}</td>
                  {showActions && (
                    <td>
                      <button
                        className="btn btn-sm btn-outline-primary"
                        onClick={() => router.push(`/registration/print?visitorID=${row.visitorsID}`)}
                      >
                        Generate QR Code
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Table;