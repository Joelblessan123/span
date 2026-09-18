import React, { lazy, Suspense, useMemo } from 'react'
import { billStateGroupKey, usStateAbbreviation } from '../../lib/usStateCanonical'
import {
  BillAssignmentsMemberAssignedPanel,
  BillAssignmentsOpenTasksPanel,
} from './BillAssignmentsMemberPanels'

const BillResearchPanel = lazy(() => import('../../components/BillResearchPanel'))
const BillOutreachPanel = lazy(() => import('../../components/BillOutreachPanel'))

function PanelFallback({ label = 'Loading…' }) {
  return (
    <div className="text-center py-4">
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">{label}</span>
      </div>
    </div>
  )
}

export default function BillSubmissionSection({
  sectionOrder,
  sectionId,
  viewAsData,
  effectiveMember,

  memberBillSectionTab,
  setMemberBillSectionTab,

  billSubmissionViewTab,

  handleAddBill,

  // Research tab
  researchBills,
  researchBillsLoading,
  researchBillsError,
  researchBillSearchState,
  setResearchBillSearchState,
  researchBillSearchNumber,
  setResearchBillSearchNumber,
  researchBillSearchKeywords,
  setResearchBillSearchKeywords,
  researchBillStatusFilter,
  setResearchBillStatusFilter,
  allMembers,
  getBillPdfUrl,
  formatDate,
  loadResearchBills,
  getStateFileName,

  // Open tasks + assigned to me
  billAssignments,
  handleClaimBillAssignment,
  resolveBillAssignmentMemberName,
  memberAssignmentFilter,
  setMemberAssignmentFilter,
  effectiveMemberId,
  memberDeliverableInputs,
  setMemberDeliverableInputs,
  handleSaveAssignmentDeliverable,
  handleAssigneeAssignmentStatus,

  // All bills (same list execs see) + outreach
  effectiveBills,
  setBillPdfPreviewBill,
  formatDateLong,

  outreachBills,
  member,
  loadAllBills,
  mentorOnly = false,
}) {
  const { billsByState, sortedStates } = useMemo(() => {
    const grouped = {}
    ;(effectiveBills || []).forEach((bill) => {
      if (bill.status === 'outreach_only') return
      const k = billStateGroupKey(bill.state)
      if (!grouped[k]) grouped[k] = []
      grouped[k].push(bill)
    })
    const sorted = Object.keys(grouped).sort((a, b) => {
      if (a === 'Unknown') return 1
      if (b === 'Unknown') return -1
      return a.localeCompare(b)
    })
    return { billsByState: grouped, sortedStates: sorted }
  }, [effectiveBills])

  const stateSectionLabel = (stateKey) => {
    if (stateKey === 'Unknown') return 'Unknown / not set'
    const abbr = usStateAbbreviation(stateKey)
    return abbr && abbr !== stateKey ? `${stateKey} (${abbr})` : stateKey
  }

  return (
    <section id={sectionId} className="mt-5 dashboard-section-anchor" style={{ order: sectionOrder }}>
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div>
          <h3 className="mb-0">
            {viewAsData ? 'Assigned to me' : mentorOnly ? 'Policy tools' : 'Bill Submission'}
          </h3>
          {viewAsData && (
            <p className="small text-muted mb-0 mt-1">
              {effectiveMember?.first_name} {effectiveMember?.last_name} (read-only)
            </p>
          )}
          {mentorOnly && !viewAsData && (
            <p className="small text-muted mb-0 mt-1">
              Research bills on LegiScan and compose outreach (preview only — mentors cannot send email on SPAN’s
              behalf).
            </p>
          )}
        </div>

        {!viewAsData && !mentorOnly && memberBillSectionTab === 'my_bills' && (
          <button className="btn btn-dark" onClick={handleAddBill}>
            <i className="bi bi-plus-circle me-2"></i>Submit Bill for Review
          </button>
        )}
      </div>

      {!viewAsData && (
        <div className="btn-group mb-3" role="group">
          {!mentorOnly && (
            <>
              <button
                type="button"
                className={`btn btn-sm ${
                  memberBillSectionTab === 'my_bills' ? 'btn-primary' : 'btn-outline-secondary'
                }`}
                onClick={() => setMemberBillSectionTab('my_bills')}
              >
                All bills
              </button>
              <button
                type="button"
                className={`btn btn-sm ${
                  memberBillSectionTab === 'assigned_to_me' ? 'btn-primary' : 'btn-outline-secondary'
                }`}
                onClick={() => setMemberBillSectionTab('assigned_to_me')}
              >
                Assigned to me
              </button>
              <button
                type="button"
                className={`btn btn-sm ${
                  memberBillSectionTab === 'open_tasks' ? 'btn-primary' : 'btn-outline-secondary'
                }`}
                onClick={() => setMemberBillSectionTab('open_tasks')}
              >
                Open tasks
              </button>
            </>
          )}
          <button
            type="button"
            className={`btn btn-sm ${
              memberBillSectionTab === 'research' ? 'btn-primary' : 'btn-outline-secondary'
            }`}
            onClick={() => setMemberBillSectionTab('research')}
          >
            Research
          </button>
          <button
            type="button"
            className={`btn btn-sm ${
              memberBillSectionTab === 'outreach' ? 'btn-primary' : 'btn-outline-secondary'
            }`}
            onClick={() => setMemberBillSectionTab('outreach')}
          >
            Outreach
          </button>
        </div>
      )}

      {billSubmissionViewTab === 'outreach' ? (
        <Suspense fallback={<PanelFallback label="Loading outreach…" />}>
          <BillOutreachPanel bills={outreachBills} member={member} onBillsChanged={loadAllBills} />
        </Suspense>
      ) : billSubmissionViewTab === 'research' ? (
        <Suspense fallback={<PanelFallback label="Loading research…" />}>
          <BillResearchPanel
            bills={researchBills}
            loading={researchBillsLoading}
            loadError={researchBillsError}
            spanSearchState={researchBillSearchState}
            onSpanSearchStateChange={setResearchBillSearchState}
            spanSearchBillNumber={researchBillSearchNumber}
            onSpanSearchBillNumberChange={setResearchBillSearchNumber}
            spanSearchKeywords={researchBillSearchKeywords}
            onSpanSearchKeywordsChange={setResearchBillSearchKeywords}
            statusFilter={researchBillStatusFilter}
            onStatusFilterChange={setResearchBillStatusFilter}
            allMembers={allMembers}
            getBillPdfUrl={getBillPdfUrl}
            formatDate={formatDate}
            onRefresh={loadResearchBills}
            getStateFileName={getStateFileName}
          />
        </Suspense>
      ) : billSubmissionViewTab === 'open_tasks' ? (
        <>
          <p className="text-muted small mb-3">
            Tasks anyone with Bill permission can pick up. <strong>Only one person</strong> can claim each
            task (first come, first served). After you claim it, it moves to <strong>Assigned to me</strong>
            for you.
          </p>
          <BillAssignmentsOpenTasksPanel
            billAssignments={billAssignments}
            formatDate={formatDate}
            resolveMemberName={resolveBillAssignmentMemberName}
            onClaim={handleClaimBillAssignment}
          />
        </>
      ) : billSubmissionViewTab === 'assigned_to_me' ? (
        <BillAssignmentsMemberAssignedPanel
          billAssignments={billAssignments}
          memberAssignmentFilter={memberAssignmentFilter}
          onMemberAssignmentFilterChange={setMemberAssignmentFilter}
          effectiveMemberId={effectiveMemberId}
          memberDeliverableInputs={memberDeliverableInputs}
          setMemberDeliverableInputs={setMemberDeliverableInputs}
          formatDate={formatDate}
          viewAsData={viewAsData}
          onSaveDeliverable={handleSaveAssignmentDeliverable}
          onAssigneeStatus={handleAssigneeAssignmentStatus}
        />
      ) : effectiveBills.length > 0 ? (
        <div>
          <h4 className="mb-3">{viewAsData ? 'Submitted bills' : 'All bills'}</h4>
          <p className="text-muted small mb-3">Grouped by state — expand a state to see bills.</p>
          <div className="accordion mb-4" id="accordion-all-bills-by-state" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            {sortedStates.map((stateKey, stateIdx) => (
              <div className="accordion-item mb-2 border rounded shadow-sm" key={stateKey}>
                <h2 className="accordion-header">
                  <button
                    className={`accordion-button ${stateIdx === 0 ? '' : 'collapsed'} bg-light`}
                    type="button"
                    data-bs-toggle="collapse"
                    data-bs-target={`#collapseBillStateSection${stateIdx}`}
                    aria-expanded={stateIdx === 0 ? 'true' : 'false'}
                  >
                    <span className="fw-semibold me-2">{stateSectionLabel(stateKey)}</span>
                    <span className="badge bg-secondary">{billsByState[stateKey].length}</span>
                  </button>
                </h2>
                <div
                  id={`collapseBillStateSection${stateIdx}`}
                  className={`accordion-collapse collapse ${stateIdx === 0 ? 'show' : ''}`}
                >
                  <div className="accordion-body p-2 bg-white">
                    <div className="accordion accordion-flush">
                      {billsByState[stateKey].map((bill) => (
                        <div key={bill.bill_id} className="accordion-item border rounded mb-2">
                          <h3 className="accordion-header">
                            <button
                              className="accordion-button collapsed bg-white text-dark py-2"
                              type="button"
                              data-bs-toggle="collapse"
                              data-bs-target={`#collapseMyBill${bill.bill_id}`}
                              aria-expanded="false"
                            >
                              <div className="d-flex w-100 justify-content-between align-items-center flex-wrap gap-1">
                                <span className="fw-bold">{bill.name}</span>
                                <span
                                  className={`badge ${
                                    bill.status === 'approved'
                                      ? 'bg-success'
                                      : bill.status === 'modified'
                                        ? 'bg-info'
                                        : bill.status === 'rejected'
                                          ? 'bg-danger'
                                          : 'bg-warning text-dark'
                                  }`}
                                >
                                  {bill.status === 'under_review'
                                    ? 'Under Review'
                                    : bill.status === 'approved'
                                      ? 'Approved'
                                      : bill.status === 'modified'
                                        ? 'Modified'
                                        : bill.status === 'rejected'
                                          ? 'Rejected'
                                          : 'Pending'}
                                </span>
                                {bill.hidden && (
                                  <span className="badge bg-secondary" title="Hidden from public Bills page">
                                    Hidden
                                  </span>
                                )}
                                <span className="text-muted small">{formatDate(bill.bill_date)}</span>
                              </div>
                            </button>
                          </h3>

                          <div id={`collapseMyBill${bill.bill_id}`} className="accordion-collapse collapse">
                            <div className="accordion-body">
                              <div className="mb-3">
                                <strong>State:</strong>
                                <p className="mt-1 mb-0">{bill.state}</p>
                              </div>
                              <div className="mb-3">
                                <strong>Description:</strong>
                                <p className="mt-1 mb-0">{bill.description || '-'}</p>
                              </div>
                              <div className="mb-3">
                                <strong>Status:</strong>
                                <p className="mt-1 mb-0">
                                  <span
                                    className={`badge ${
                                      bill.status === 'approved'
                                        ? 'bg-success'
                                        : bill.status === 'modified'
                                          ? 'bg-info'
                                          : bill.status === 'rejected'
                                            ? 'bg-danger'
                                            : 'bg-warning text-dark'
                                    }`}
                                  >
                                    {bill.status === 'under_review'
                                      ? 'Under Review'
                                      : bill.status === 'approved'
                                        ? 'Approved'
                                        : bill.status === 'modified'
                                          ? 'Modified & Approved'
                                          : bill.status === 'rejected'
                                            ? 'Rejected'
                                            : 'Pending'}
                                  </span>
                                </p>
                              </div>
                              {bill.review_notes && (
                                <div className="mb-3">
                                  <strong>Review Notes:</strong>
                                  <p className="mt-1 mb-0">{bill.review_notes}</p>
                                </div>
                              )}
                              {bill.reviewed_at && (
                                <div className="mb-3">
                                  <strong>Reviewed:</strong>
                                  <p className="mt-1 mb-0">{formatDateLong(bill.reviewed_at)}</p>
                                </div>
                              )}
                              {bill.legiscan_link && (
                                <div className="mb-3">
                                  <strong>LegiScan:</strong>
                                  <p className="mt-1 mb-0">
                                    <a
                                      href={bill.legiscan_link}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-primary"
                                    >
                                      {bill.legiscan_link}
                                    </a>
                                  </p>
                                </div>
                              )}
                              {bill.google_doc_link && (
                                <div className="mb-3">
                                  <strong>Proposal (Google Doc):</strong>
                                  <p className="mt-1 mb-0">
                                    <a
                                      href={bill.google_doc_link}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-primary"
                                    >
                                      Open proposal doc
                                    </a>
                                  </p>
                                </div>
                              )}
                              <div className="mt-3 d-flex gap-2 flex-wrap">
                                {bill.pdfExists && (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-dark"
                                    onClick={() => setBillPdfPreviewBill(bill)}
                                  >
                                    <i className="bi bi-file-pdf me-1"></i>View PDF
                                  </button>
                                )}
                                {bill.google_doc_link && (
                                  <a
                                    href={bill.google_doc_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-sm btn-outline-secondary"
                                  >
                                    <i className="bi bi-link-45deg me-1"></i>Proposal (Google Doc)
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-5 text-muted">
          <i className="bi bi-file-earmark-text display-4 d-block mb-3"></i>
          <p>
            {viewAsData ? 'No submitted bills for this member.' : 'No bills to show yet.'}
          </p>
        </div>
      )}
    </section>
  )
}

