import React, { useEffect, useMemo, useState } from 'react'; // Import React core plus hooks for state, side-effects, and memoized calculations
import { Download, Image as ImageIcon, Trash2, Upload } from 'lucide-react'; // Import icons for UI buttons

// Define the progressive Nigerian income tax brackets required by the brief
const TAX_BRACKETS = [
  { limit: 800000, rate: 0 }, // First ₦800,000 is tax free
  { limit: 3000000, rate: 0.15 }, // Next ₦2,200,000 taxed at 15%
  { limit: 12000000, rate: 0.18 }, // Next ₦9,000,000 taxed at 18%
  { limit: 25000000, rate: 0.21 }, // Next ₦13,000,000 taxed at 21%
  { limit: 50000000, rate: 0.23 }, // Next ₦25,000,000 taxed at 23%
  { limit: Infinity, rate: 0.25 }, // Income above ₦50,000,000 taxed at 25%
];

// Define core debit keywords for quick rejection
const CRITICAL_DEBIT_KEYWORDS = ['debit', 'dr'];

// Define additional debit keywords for fallback detection
const DEBIT_KEYWORDS = [
  'debited',
  'withdrawal',
  'withdraw',
  'transferred',
  'transfer from your',
  'payment to',
  'paid to',
  'sent to',
  'deducted',
  'charged',
  'purchase',
  'atm withdrawal',
  'pos purchase',
  'bill payment',
];

// Define credit keywords to ensure SMS indicates incoming funds
const CREDIT_KEYWORDS = [
  'credited',
  'credit',
  'received',
  'deposit',
  'transfer from',
  'payment from',
  'salary',
  'refund',
  'reversal',
];

// Preload common Nigerian bank names for quick tagging
const BANK_NAMES = ['GTBank', 'Access', 'Zenith', 'First Bank', 'UBA', 'Stanbic', 'Kuda', 'Fidelity', 'Wema', 'Union'];

// Utility to safely access the storage API while falling back to localStorage
const storage = {
  // Retrieve a value using either window.storage or browser localStorage
  async get(key) {
    if (window.storage?.get) {
      return window.storage.get(key);
    }
    const value = localStorage.getItem(key);
    return value ? { value } : null;
  },
  // Save a value using either window.storage or browser localStorage
  async set(key, value) {
    if (window.storage?.set) {
      return window.storage.set(key, value);
    }
    localStorage.setItem(key, value);
  },
};

export default function App() {
  const [smsText, setSmsText] = useState(''); // Holds manually pasted or OCR-extracted SMS text
  const [transactions, setTransactions] = useState([]); // Stores accepted income transactions
  const [userName, setUserName] = useState(''); // Saved user name for sender/receiver detection
  const [tempName, setTempName] = useState(''); // Buffer for editing the user name
  const [selectedImage, setSelectedImage] = useState(null); // Object URL for uploaded screenshot preview
  const [isProcessingImage, setIsProcessingImage] = useState(false); // Flag for OCR request state
  const [showNameInput, setShowNameInput] = useState(false); // Controls profile modal visibility
  const [showDebitPopup, setShowDebitPopup] = useState(false); // Controls debit alert modal visibility
  const [error, setError] = useState(''); // Error feedback banner text
  const [success, setSuccess] = useState(''); // Success feedback banner text

  // Load stored data once on mount
  useEffect(() => {
    loadTransactions();
    loadUserName();
  }, []);

  // Fetch persisted transactions from storage
  async function loadTransactions() {
    try {
      const stored = await storage.get('income-transactions');
      if (stored?.value) {
        setTransactions(JSON.parse(stored.value));
      }
    } catch (err) {
      console.error('Failed to load transactions', err);
    }
  }

  // Fetch saved user name from storage
  async function loadUserName() {
    try {
      const stored = await storage.get('user-name');
      if (stored?.value) {
        setUserName(stored.value);
        setTempName(stored.value);
      }
    } catch (err) {
      console.error('Failed to load user name', err);
    }
  }

  // Persist the provided transactions list
  async function persistTransactions(next) {
    await storage.set('income-transactions', JSON.stringify(next));
  }

  // Persist the user's name for sender/receiver checks
  async function saveUserName() {
    try {
      await storage.set('user-name', tempName.trim());
      setUserName(tempName.trim());
      setShowNameInput(false);
      flashSuccess('Name saved successfully');
    } catch (err) {
      flashError(`Failed to save name: ${err.message}`);
    }
  }

  // Helper to show success feedback briefly
  function flashSuccess(message) {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 3500);
  }

  // Helper to show error feedback briefly
  function flashError(message) {
    setError(message);
    setTimeout(() => setError(''), 4500);
  }

  // Convert an uploaded image file to a base64 string for OCR
  function convertImageToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });
  }

  // Submit the uploaded image to Claude's vision endpoint for OCR
  async function handleImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      flashError('Please select a valid image file');
      return;
    }

    setSelectedImage(URL.createObjectURL(file));
    setIsProcessingImage(true);
    setError('');

    try {
      const base64Image = await convertImageToBase64(file);
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'YOUR_CLAUDE_API_KEY', // Replace with a valid API key at runtime
        },
        body: JSON.stringify({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 1000,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: file.type, data: base64Image },
                },
                {
                  type: 'text',
                  text: 'Extract ALL text from this bank alert SMS screenshot. Return ONLY the plain text with no commentary.',
                },
              ],
            },
          ],
        }),
      });

      const data = await response.json();
      const extractedText = (data.content || [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      setSmsText(extractedText);
      flashSuccess('Text extracted from image. Review and add transaction.');
    } catch (err) {
      flashError(`Failed to process image: ${err.message}`);
    } finally {
      setIsProcessingImage(false);
    }
  }

  // Determine if the SMS clearly marks the current user as the receiver
  function isUserReceiver(text) {
    if (!userName) return false;
    const name = userName.trim().toLowerCase();
    const patterns = [
      new RegExp(`\\bto\\s+${name}\\b`, 'i'),
      new RegExp(`\\bcredited\\s+to\\s+${name}\\b`, 'i'),
      new RegExp(`\\bbeneficiary[:\\s]+${name}\\b`, 'i'),
      new RegExp(`\\breceiver[:\\s]+${name}\\b`, 'i'),
      new RegExp(`\\brecipient[:\\s]+${name}\\b`, 'i'),
      new RegExp(`\\bpayment\\s+to\\s+${name}\\b`, 'i'),
    ];
    return patterns.some((pattern) => pattern.test(text));
  }

  // Determine if the SMS shows the user as the sender (debit)
  function isUserSender(text) {
    if (!userName) return false;
    const name = userName.trim().toLowerCase();
    const patterns = [
      new RegExp(`\\bfrom\\s+${name}\\b`, 'i'),
      new RegExp(`\\bsender[:\\s]+${name}\\b`, 'i'),
      new RegExp(`\\bby\\s+${name}\\b`, 'i'),
      new RegExp(`\\btransfer\\s+from\\s+${name}\\b`, 'i'),
    ];
    return patterns.some((pattern) => pattern.test(text));
  }

  // Check debit keywords with high priority critical terms first
  function isDebitTransaction(text) {
    for (const keyword of CRITICAL_DEBIT_KEYWORDS) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(text)) return true;
    }
    const lower = text.toLowerCase();
    return DEBIT_KEYWORDS.some((keyword) => lower.includes(keyword));
  }

  // Confirm that the SMS looks like a credit alert
  function isCreditTransaction(text) {
    const lower = text.toLowerCase();
    return CREDIT_KEYWORDS.some((keyword) => lower.includes(keyword));
  }

  // Parse the SMS into a transaction object
  function parseSMS(text) {
    const transaction = {
      id: crypto.randomUUID(),
      date: extractDate(text),
      amount: extractAmount(text),
      description: extractDescription(text),
      bank: extractBank(text),
      rawSMS: text,
    };
    return transaction;
  }

  // Extract the first monetary amount found in the SMS
  function extractAmount(text) {
    const patterns = [
      /(?:NGN|₦|N)\s*([0-9,.]+)/i,
      /credited\s+with\s+([0-9,.]+)/i,
      /received\s+([0-9,.]+)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return parseFloat(match[1].replace(/,/g, '')) || 0;
      }
    }
    return 0;
  }

  // Try to extract a date from the SMS, otherwise use today
  function extractDate(text) {
    const match = text.match(/(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4})/);
    if (match?.[1]) {
      return match[1].replace(/\//g, '-');
    }
    return new Date().toISOString().split('T')[0];
  }

  // Pull a short description or fallback to SMS snippet
  function extractDescription(text) {
    const descMatch = text.match(/(?:from|narration|desc|description)[:\s]+([^\.\n]+)/i);
    if (descMatch?.[1]) {
      return descMatch[1].trim();
    }
    return text.slice(0, 60).trim() + (text.length > 60 ? '...' : '');
  }

  // Identify the sending bank if present
  function extractBank(text) {
    for (const bank of BANK_NAMES) {
      if (text.toLowerCase().includes(bank.toLowerCase())) {
        return bank;
      }
    }
    return 'Unknown';
  }

  // Handle add transaction click with all validation rules
  async function handleAddTransaction() {
    if (!smsText.trim()) {
      flashError('Please enter SMS text or use OCR.');
      return;
    }

    if (isUserReceiver(smsText)) {
      acceptCredit();
      return;
    }

    if (isUserSender(smsText) || isDebitTransaction(smsText)) {
      setShowDebitPopup(true);
      flashError('Debit detected! Only credit income alerts are accepted.');
      return;
    }

    if (!isCreditTransaction(smsText)) {
      flashError('Unable to confirm this is a credit alert.');
      return;
    }

    acceptCredit();
  }

  // Persist a parsed credit transaction
  async function acceptCredit() {
    const newTransaction = parseSMS(smsText);
    if (newTransaction.amount <= 0) {
      flashError('Could not extract a valid amount from the SMS.');
      return;
    }
    const next = [newTransaction, ...transactions];
    setTransactions(next);
    await persistTransactions(next);
    setSmsText('');
    setSelectedImage(null);
    flashSuccess('Income transaction added successfully');
  }

  // Delete a transaction by id
  async function handleDelete(id) {
    const next = transactions.filter((t) => t.id !== id);
    setTransactions(next);
    await persistTransactions(next);
    flashSuccess('Transaction deleted');
  }

  // Export transactions as a CSV file
  function handleExport() {
    const header = 'Date,Amount,Description,Bank\n';
    const rows = transactions
      .map((t) => `${t.date},${t.amount},"${t.description.replace(/"/g, '""')}",${t.bank}`)
      .join('\n');
    const csv = header + rows;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `income-transactions-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Calculate annual tax based on total income using progressive brackets
  function calculateTax(income) {
    let tax = 0;
    let previousLimit = 0;
    for (const bracket of TAX_BRACKETS) {
      if (income <= bracket.limit) {
        tax += (income - previousLimit) * bracket.rate;
        break;
      }
      tax += (bracket.limit - previousLimit) * bracket.rate;
      previousLimit = bracket.limit;
    }
    return tax;
  }

  // Memoize summary values for rendering efficiency
  const totalIncome = useMemo(() => transactions.reduce((sum, t) => sum + t.amount, 0), [transactions]);
  const annualTax = useMemo(() => calculateTax(totalIncome), [totalIncome]);
  const netIncome = useMemo(() => totalIncome - annualTax, [totalIncome, annualTax]);
  const effectiveRate = useMemo(() => (totalIncome > 0 ? (annualTax / totalIncome) * 100 : 0), [totalIncome, annualTax]);

  // Build per-bracket breakdown for UI display
  const taxBreakdown = useMemo(() => {
    let remaining = totalIncome;
    let previousLimit = 0;
    return TAX_BRACKETS.map((bracket) => {
      const bracketCap = bracket.limit === Infinity ? remaining : Math.max(Math.min(bracket.limit - previousLimit, remaining), 0);
      const taxable = Math.max(Math.min(remaining, bracketCap), 0);
      remaining -= taxable;
      previousLimit = bracket.limit;
      return {
        ...bracket,
        taxable,
        tax: taxable * bracket.rate,
      };
    });
  }, [totalIncome]);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8 relative overflow-hidden">
      {/* Decorative gradient background overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/20 via-blue-600/10 to-indigo-700/30 pointer-events-none" />

      <div className="relative max-w-6xl mx-auto space-y-6">
        {/* Header with profile controls */}
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl border border-white/10 p-6 shadow-2xl">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-sm text-emerald-200 uppercase tracking-[0.2em]">Income Tax Tracker</p>
              <h1 className="text-3xl font-bold">Track credits. Reject debits. Stay tax-ready.</h1>
              <p className="text-slate-200 mt-1">Paste SMS text or upload screenshots to capture income instantly.</p>
            </div>
            <div className="bg-white/10 rounded-2xl p-4 border border-white/10 w-full md:w-auto">
              {userName ? (
                <div className="text-right">
                  <p className="text-xs text-slate-200">Tracking for</p>
                  <p className="text-lg font-semibold">{userName}</p>
                  <button
                    onClick={() => setShowNameInput(true)}
                    className="text-emerald-200 hover:text-white text-sm underline"
                  >
                    Edit name
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowNameInput(true)}
                  className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl font-semibold text-white"
                >
                  + Add your name
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Feedback banners */}
        {error && (
          <div className="bg-red-500/20 border border-red-400/30 text-red-100 p-4 rounded-2xl">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-emerald-500/20 border border-emerald-400/30 text-emerald-100 p-4 rounded-2xl">
            {success}
          </div>
        )}

        {/* Main layout grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white/10 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-xl space-y-4">
              <div className="flex items-center gap-3">
                <span className="bg-emerald-500/20 text-emerald-200 p-2 rounded-xl">📝</span>
                <h2 className="text-xl font-semibold">Add transaction</h2>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <label className="relative flex flex-col items-center justify-center gap-3 p-6 border-2 border-dashed border-emerald-300/40 rounded-2xl bg-white/5 hover:border-emerald-300/70 transition-colors cursor-pointer">
                  <div className="bg-white/10 rounded-full p-3">
                    <Upload className="text-emerald-200" />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold">Upload bank SMS screenshot</p>
                    <p className="text-sm text-slate-200">We will OCR with Claude for you</p>
                  </div>
                  <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleImageUpload} />
                </label>

                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm text-slate-200">
                    <ImageIcon size={18} />
                    <span>{selectedImage ? 'Preview selected' : 'No image selected'}</span>
                  </div>
                  {selectedImage ? (
                    <img src={selectedImage} alt="SMS preview" className="w-full h-40 object-cover rounded-xl border border-white/10" />
                  ) : (
                    <div className="w-full h-40 bg-slate-900/60 rounded-xl border border-white/5 flex items-center justify-center text-slate-500">
                      Upload an image to preview
                    </div>
                  )}
                  {isProcessingImage && <p className="text-xs text-amber-200">Processing image with Claude...</p>}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm text-slate-200">Paste SMS text</p>
                <textarea
                  value={smsText}
                  onChange={(e) => setSmsText(e.target.value)}
                  rows={5}
                  className="w-full p-4 rounded-2xl bg-slate-900/70 border border-white/10 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 outline-none"
                  placeholder="Paste the bank SMS text here..."
                />
              </div>

              <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                <p className="text-xs text-slate-300">
                  Debit keywords like "debit" / "DR" will be blocked unless your name is detected as the receiver.
                </p>
                <button
                  onClick={handleAddTransaction}
                  className="px-5 py-3 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl font-semibold shadow-lg hover:translate-y-[-1px] transition"
                >
                  Add transaction
                </button>
              </div>
            </div>

            <div className="bg-white/10 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <span className="bg-blue-500/20 text-blue-100 p-2 rounded-xl">📊</span>
                <h3 className="text-lg font-semibold">Tax breakdown</h3>
              </div>
              <div className="space-y-3">
                {taxBreakdown.map((bracket, index) => (
                  <div key={index} className="bg-white/5 rounded-2xl p-4 border border-white/5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <p className="text-sm text-slate-200">
                        {index === 0 ? '₦0 - ₦800,000' : `Above ₦${(TAX_BRACKETS[index - 1].limit).toLocaleString()} to ₦${bracket.limit === Infinity ? '∞' : bracket.limit.toLocaleString()}`}
                      </p>
                      <p className="text-xl font-bold">{(bracket.rate * 100).toFixed(0)}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-slate-300">Taxable: ₦{bracket.taxable.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p>
                      <p className="text-sm text-emerald-200 font-semibold">Tax: ₦{bracket.tax.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Summary column */}
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-emerald-500 to-blue-600 rounded-3xl p-6 shadow-2xl text-white">
              <div className="flex items-center gap-3 mb-2">
                <span className="bg-white/20 p-2 rounded-xl">💵</span>
                <p className="text-sm uppercase tracking-wide">Total income</p>
              </div>
              <p className="text-4xl font-bold">₦{totalIncome.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p>
              <p className="text-sm text-emerald-100">Across {transactions.length} transaction(s)</p>
            </div>

            <div className="bg-gradient-to-br from-red-500 to-orange-600 rounded-3xl p-6 shadow-2xl text-white">
              <div className="flex items-center gap-3 mb-2">
                <span className="bg-white/20 p-2 rounded-xl">🏛️</span>
                <p className="text-sm uppercase tracking-wide">Annual tax</p>
              </div>
              <p className="text-4xl font-bold">₦{annualTax.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p>
              <p className="text-sm text-orange-100">Effective rate: {effectiveRate.toFixed(2)}%</p>
            </div>

            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl p-6 shadow-2xl text-white">
              <div className="flex items-center gap-3 mb-2">
                <span className="bg-white/20 p-2 rounded-xl">💎</span>
                <p className="text-sm uppercase tracking-wide">Net income</p>
              </div>
              <p className="text-4xl font-bold">₦{netIncome.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p>
              <p className="text-sm text-purple-100">Monthly average: ₦{(totalIncome / 12).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p>
            </div>

            <button
              onClick={handleExport}
              disabled={!transactions.length}
              className="w-full bg-white/10 border border-white/20 text-white py-4 rounded-2xl font-semibold flex items-center justify-center gap-3 hover:bg-white/20 disabled:opacity-50"
            >
              <Download />
              Export CSV
            </button>
          </div>
        </div>

        {/* Transaction history */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <span className="bg-blue-500/20 text-blue-100 p-2 rounded-xl">📋</span>
            <h3 className="text-lg font-semibold">Transaction history</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-slate-100">
              <thead className="text-xs uppercase tracking-wide text-slate-300">
                <tr>
                  <th className="py-3 px-2">Date</th>
                  <th className="py-3 px-2">Amount</th>
                  <th className="py-3 px-2">Description</th>
                  <th className="py-3 px-2">Bank</th>
                  <th className="py-3 px-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-300">
                      No transactions yet. Upload a screenshot or paste SMS text to begin.
                    </td>
                  </tr>
                ) : (
                  transactions.map((t) => (
                    <tr key={t.id} className="hover:bg-white/5">
                      <td className="py-3 px-2 whitespace-nowrap">{t.date}</td>
                      <td className="py-3 px-2 font-semibold text-emerald-200">₦{t.amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 px-2">{t.description}</td>
                      <td className="py-3 px-2">
                        <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10 text-sm">{t.bank}</span>
                      </td>
                      <td className="py-3 px-2 text-center">
                        <button
                          onClick={() => handleDelete(t.id)}
                          className="text-red-200 hover:text-white hover:bg-red-500/20 p-2 rounded-lg"
                          title="Delete transaction"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* User name modal */}
      {showNameInput && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 rounded-3xl border border-white/10 p-6 w-full max-w-md space-y-4">
            <h3 className="text-xl font-semibold">Set your profile name</h3>
            <p className="text-slate-300 text-sm">
              Your name lets the detector bypass debit keywords when you are the receiver in the SMS.
            </p>
            <input
              type="text"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              placeholder="Enter full name as seen in alerts"
              className="w-full p-3 rounded-2xl bg-slate-800 border border-white/10 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30 outline-none"
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowNameInput(false)} className="px-4 py-2 rounded-xl bg-white/10 border border-white/20">Cancel</button>
              <button
                onClick={saveUserName}
                disabled={!tempName.trim()}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-blue-500 font-semibold disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debit detection modal */}
      {showDebitPopup && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-red-900 rounded-3xl border border-red-300/40 p-6 w-full max-w-md space-y-3 text-white shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 rounded-full p-3">⚠️</div>
              <h3 className="text-xl font-bold">Debit transaction detected</h3>
            </div>
            <p className="text-sm text-red-100">
              This SMS includes debit language. Credits are accepted only when your name appears as the receiver.
            </p>
            <button
              onClick={() => setShowDebitPopup(false)}
              className="w-full bg-white/20 hover:bg-white/30 text-white py-3 rounded-xl font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
