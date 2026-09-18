import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react'
import { supabase } from '../lib/supabase'
import RegistrationForm from '../components/RegistrationForm'
import { memberLegalName, memberSiteDisplayName } from '../lib/memberDisplayName'
import { resolveMemberGrade, splitMemberGradeForForm } from '../lib/memberGrades'
import { billStateGroupKey, canonicalUSStateName } from '../lib/usStateCanonical'
import {
  buildCanonicalProposalPdf,
  enrichBillWithStoredPdf,
} from '../lib/proposalPdf'
import { fetchLegiscanBillBySearch, isLegiscanBillNumberShape } from '../lib/legiscan'
import { getClassroomSessionRole } from '../lib/classroom'
import { getMentorSession, provisionMentorLogin, syntheticMemberFromMentorSession } from '../lib/mentors'
import { isAllowedApplicationStatusTransition } from './dashboard/applications'
import BillAssignmentsExecPanel from './dashboard/BillAssignmentsExecPanel'
import {
  BillAssignmentsMemberAssignedPanel,
  BillAssignmentsOpenTasksPanel,
} from './dashboard/BillAssignmentsMemberPanels'
import {
  billAssignmentAssigneeIds,
  billIdMatchingAssignmentPrefill,
  normalizeBillFormPosition,
} from './dashboard/billAssignments'
import DeleteBillAssignmentModal from './dashboard/DeleteBillAssignmentModal'
import DeleteBillModal from './dashboard/DeleteBillModal'
import VolunteerEntryModal from './dashboard/VolunteerEntryModal'
import HrReportSubmitModal from './dashboard/HrReportSubmitModal'
import HrReportViewModal from './dashboard/HrReportViewModal'
import ResignFromSpanSection from './dashboard/ResignFromSpanSection'
import { strikeLimitForMember, isAtStrikeLimit } from '../lib/memberStrikeRules'
import DashboardSectionNav from './dashboard/DashboardSectionNav'
import { buildDashboardSectionNavItems, DASHBOARD_SECTION_IDS } from './dashboard/dashboardSectionAnchors'
import LeaveRequestQuickReviewModal from './dashboard/LeaveRequestQuickReviewModal'
import LeaveRequestSubmitModal from './dashboard/LeaveRequestSubmitModal'
import LeaveRequestViewModal from './dashboard/LeaveRequestViewModal'
import SuggestionViewModal from './dashboard/SuggestionViewModal'
import MentorCredentialsModal from './dashboard/MentorCredentialsModal'
import BillPdfPreviewModal from './dashboard/BillPdfPreviewModal'
import DeleteVolunteerEntryModal from './dashboard/DeleteVolunteerEntryModal'
import YourInfoSection from './dashboard/YourInfoSection'
import ExecTeamsSection from './dashboard/ExecTeamsSection'
import ImportApplicationModal from './dashboard/ImportApplicationModal'
import DeleteApplicationConfirmModal from './dashboard/DeleteApplicationConfirmModal'
import ApplicationInviteEmailPreviewModal from './dashboard/ApplicationInviteEmailPreviewModal'
import ApplicationOnboardScheduleEmailPreviewModal from './dashboard/ApplicationOnboardScheduleEmailPreviewModal'
import ApplicationRejectConfirmModal from './dashboard/ApplicationRejectConfirmModal'
import ApplicationMetWithDateModal from './dashboard/ApplicationMetWithDateModal'
import SpanCardPasswordModal from './dashboard/SpanCardPasswordModal'
import VolunteerSupervisorCommentModal from './dashboard/VolunteerSupervisorCommentModal'
import {
  ApplicationsSection,
  AnalyticsSection,
  ClassroomSection,
  MemberManagementSection,
  ExecConductSection,
  ExecBillManagementSection,
  BillSubmissionSection,
  HrReportsSection,
  TeamLeadAssignmentsSection,
  IdeasSuggestionsSection,
  VolunteerHoursSection,
  LeaveExtensionSection,
  AssignBillWorkModal,
  BillEditModal,
  BillUploadModal,
  ApplicationViewModal,
  MemberStrikeModal,
  MemberRemovalModal,
  HonorableExitEmailModal,
  RemovalNoticeEmailModal,
  PolicyViolationEmailModal,
  VolunteerVerificationModal,
  MemberFormModal,
  PartnerFormModal,
  SchoolFormModal,
  AdvisorFormModal,
} from './dashboard/lazyDashboardPanels'
import {
  IMAGE_BASE_URL,
  PARTNERS_IMAGES_BASE_URL,
  SCHOOLS_IMAGES_BASE_URL,
  ADVISORS_IMAGES_BASE_URL,
} from './dashboard/constants'

function DashboardLazyFallback({ label = 'Loading…' }) {
  return (
    <div className="text-center py-4">
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">{label}</span>
      </div>
    </div>
  )
}
import { supabaseInvokeHeaders } from './dashboard/supabaseInvoke'
import { runAiTextCheck, checkAiFromBill, checkAiFromAssignment } from '../lib/checkAiText'
import './DashboardPage.css'

const DASHBOARD_THEME_KEY = 'span-dashboard-theme'

function readStoredDashboardTheme() {
  try {
    const v = localStorage.getItem(DASHBOARD_THEME_KEY)
    return v === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** Lead member ids merged from `policy_team_leads` in `loadPolicyTeams`. */
function policyTeamLeadIds(team) {
  const ids = team?.lead_member_ids
  return Array.isArray(ids) ? ids.map(String) : []
}

function DashboardPage() {
  console.log('DashboardPage component rendering...')
  const [member, setMember] = useState(null)
  const [loading, setLoading] = useState(true)
  const [dashboardTheme, setDashboardTheme] = useState(readStoredDashboardTheme)
  const [volunteerEntries, setVolunteerEntries] = useState([])
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showVolunteerModal, setShowVolunteerModal] = useState(false)
  const [showCommentModal, setShowCommentModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [selectedEntryId, setSelectedEntryId] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [passwordForm, setPasswordForm] = useState({ newPassword: '', confirmPassword: '' })
  const [mediumOtpLoading, setMediumOtpLoading] = useState(false)
  const [mediumOtpError, setMediumOtpError] = useState('')
  const [mediumOtpSuccess, setMediumOtpSuccess] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [volunteerForm, setVolunteerForm] = useState({
    jobTitle: '',
    jobDesc: '',
    startTime: '',
    endTime: '',
    inputMode: 'datetime', // 'datetime' or 'hours'
    hours: '',
    workDate: ''
  })
  const [volunteerError, setVolunteerError] = useState('')
  const [qrPassword, setQrPassword] = useState('')
  const [qrPasswordError, setQrPasswordError] = useState('')
  const [verifiedPassword, setVerifiedPassword] = useState('')
  const [showBillModal, setShowBillModal] = useState(false)
  /** When set, saving the bill links this assignment via resulting_bill_id. */
  const [billModalSourceAssignmentId, setBillModalSourceAssignmentId] = useState(null)
  const [billForm, setBillForm] = useState({
    state: '',
    name: '',
    position: 'Support',
    description: '',
    billDate: '',
    legiscanLink: '',
    googleDocLink: '',
    collaborators: []
  })
  const [billPdfFile, setBillPdfFile] = useState(null)
  const [billError, setBillError] = useState('')
  const [billSuccess, setBillSuccess] = useState('')
  const [allMembers, setAllMembers] = useState([])
  const [allBills, setAllBills] = useState([])
  const [billAssignments, setBillAssignments] = useState([])
  const [execBillSectionTab, setExecBillSectionTab] = useState('review_queue')
  const [memberBillSectionTab, setMemberBillSectionTab] = useState('my_bills')
  const [execAssignmentFilter, setExecAssignmentFilter] = useState('all')
  const [execAssignmentTeamFilter, setExecAssignmentTeamFilter] = useState('all')
  const [memberAssignmentFilter, setMemberAssignmentFilter] = useState('all')
  const [showAssignBillModal, setShowAssignBillModal] = useState(false)
  /** When true, Assign work modal omits bill prefill (staff / non-policy team context). */
  const [assignBillModalHidePrefill, setAssignBillModalHidePrefill] = useState(false)
  const [assignBillForm, setAssignBillForm] = useState({
    title: '',
    goal: '',
    additionalInfo: '',
    prefillState: '',
    prefillBillName: '',
    prefillPosition: 'Support',
    /** Synced bill picker in modal; not persisted */
    prefillSourceBillId: '',
    assigneeMemberIds: [],
    dueDate: '',
    /** true = open pool; anyone with Bill permission can claim */
    poolOpen: false,
  })
  const [assignBillError, setAssignBillError] = useState('')
  const [assignBillSaving, setAssignBillSaving] = useState(false)
  /** When set, Assign work modal saves updates instead of inserting */
  const [editingAssignment, setEditingAssignment] = useState(null)
  const [showDeleteAssignmentModal, setShowDeleteAssignmentModal] = useState(false)
  const [assignmentToDelete, setAssignmentToDelete] = useState(null)
  const [deleteAssignmentError, setDeleteAssignmentError] = useState('')
  const [deleteAssignmentSaving, setDeleteAssignmentSaving] = useState(false)
  /** assignee_id -> { doc, pdf } for inline deliverable fields */
  const [memberDeliverableInputs, setMemberDeliverableInputs] = useState({})
  const [researchBills, setResearchBills] = useState([])
  const [researchBillsLoading, setResearchBillsLoading] = useState(false)
  const [researchBillsError, setResearchBillsError] = useState('')
  const [researchBillSearchState, setResearchBillSearchState] = useState('')
  const [researchBillSearchNumber, setResearchBillSearchNumber] = useState('')
  const [researchBillSearchKeywords, setResearchBillSearchKeywords] = useState('')
  const [researchBillStatusFilter, setResearchBillStatusFilter] = useState('all')
  const [billFilter, setBillFilter] = useState('under_review') // exec Bill Management defaults to Under Review; 'all', 'under_review', 'approved', 'modified', 'rejected'
  const [showEditBillModal, setShowEditBillModal] = useState(false)
  const [showDeleteBillModal, setShowDeleteBillModal] = useState(false)
  const [selectedBillForEdit, setSelectedBillForEdit] = useState(null)
  const [selectedBillForDelete, setSelectedBillForDelete] = useState(null)
  const [billPdfPreviewBill, setBillPdfPreviewBill] = useState(null)
  const [editBillForm, setEditBillForm] = useState({
    state: '',
    name: '',
    position: 'Support',
    description: '',
    billDate: '',
    legiscanLink: '',
    googleDocLink: '',
    hidden: false,
    collaborators: []
  })
  const [editBillPdfFile, setEditBillPdfFile] = useState(null)
  const [showMemberModal, setShowMemberModal] = useState(false)
  const [showImportApplicationModal, setShowImportApplicationModal] = useState(false)
  const [editingMemberId, setEditingMemberId] = useState(null)
  const [allMembersForManagement, setAllMembersForManagement] = useState([])
  const [policyTeams, setPolicyTeams] = useState([])
  const [memberPolicyTeams, setMemberPolicyTeams] = useState([])
  /** Members on the current user's led policy team (for name resolution + assignee picker). */
  const [teamRosterMembers, setTeamRosterMembers] = useState([])
  const emailManuallyEdited = useRef(false)
  /** Invalidates in-flight LegiScan prefill when publish modal is opened again. */
  const publishModalLegiscanAutofillRef = useRef(0)
  /** idle | pending | filled | skipped — publish-from-assignment LegiScan URL lookup */
  const [publishLegiscanLookup, setPublishLegiscanLookup] = useState('idle')
  const [memberForm, setMemberForm] = useState({
    firstName: '',
    lastName: '',
    middleName: '',
    preferredName: '',
    email: '',
    originalEmail: '',
    role: '',
    active: true,
    startDate: '',
    dob: '',
    grade: '',
    gradeOther: '',
    schoolName: '',
    city: '',
    state: '',
    phone: '',
    linkedin: '',
    instagram: '',
    notes: '',
    bio: '',
    volunteer: false,
    applications: false,
    bills: false,
    registration: false,
    blog: false
  })
  const [memberError, setMemberError] = useState('')
  const [memberSuccess, setMemberSuccess] = useState('')
  const [memberGradeFilter, setMemberGradeFilter] = useState('all')
  const [applications, setApplications] = useState([])
  const [applicationFilter, setApplicationFilter] = useState('pending') // 'all', 'pending', 'invited', 'met_with', 'onboard', 'accepted', 'rejected'
  const [selectedApplication, setSelectedApplication] = useState(null)
  const [showApplicationModal, setShowApplicationModal] = useState(false)
  const [applicationNotes, setApplicationNotes] = useState('')
  /** Internal review score (numeric); stored as applications.numeric_grade */
  const [applicationNumericGrade, setApplicationNumericGrade] = useState('')
  const [showDeleteApplicationModal, setShowDeleteApplicationModal] = useState(false)
  const [showRejectConfirmModal, setShowRejectConfirmModal] = useState(false)
  const [showMetWithDateModal, setShowMetWithDateModal] = useState(false)
  const [metWithDateInput, setMetWithDateInput] = useState('')
  const [sendRejectionEmail, setSendRejectionEmail] = useState(true)
  const [rejectionEmailSending, setRejectionEmailSending] = useState(false)
  const [rejectionEmailPreview, setRejectionEmailPreview] = useState(null)
  const [rejectionEmailPreviewLoading, setRejectionEmailPreviewLoading] = useState(false)
  const [rejectionEmailReason, setRejectionEmailReason] = useState('')
  /** Preview + send interview invitation (pending → invited) via Resend */
  const [showInviteEmailModal, setShowInviteEmailModal] = useState(false)
  const [inviteEmailPreviewLoading, setInviteEmailPreviewLoading] = useState(false)
  const [inviteEmailPreview, setInviteEmailPreview] = useState(null)
  const [inviteEmailSending, setInviteEmailSending] = useState(false)
  /** Preview + send invitation follow-up (invited stage) via Resend */
  const [showFollowUpModal, setShowFollowUpModal] = useState(false)
  const [followUpApplication, setFollowUpApplication] = useState(null)
  const [followUpPreview, setFollowUpPreview] = useState(null)
  const [followUpPreviewLoading, setFollowUpPreviewLoading] = useState(false)
  const [followUpSending, setFollowUpSending] = useState(false)
  /** AI text detection for application writing */
  const [aiCheckResult, setAiCheckResult] = useState(null)
  const [aiCheckLoading, setAiCheckLoading] = useState(false)
  /** AI text detection for bill proposals (keyed by bill_id) */
  const [billProposalAiChecks, setBillProposalAiChecks] = useState({})
  const [billProposalAiCheckLoadingId, setBillProposalAiCheckLoadingId] = useState(null)
  /** AI text detection for assignment deliverables (keyed by assignment_id) */
  const [assignmentAiChecks, setAssignmentAiChecks] = useState({})
  const [assignmentAiCheckLoadingId, setAssignmentAiCheckLoadingId] = useState(null)
  /** Preview + send onboarding scheduling email (→ onboard) via Resend */
  const [showOnboardScheduleEmailModal, setShowOnboardScheduleEmailModal] = useState(false)
  const [onboardScheduleEmailPreviewLoading, setOnboardScheduleEmailPreviewLoading] = useState(false)
  const [onboardScheduleEmailPreview, setOnboardScheduleEmailPreview] = useState(null)
  const [onboardScheduleEmailSending, setOnboardScheduleEmailSending] = useState(false)
  /** Optional per-send fields for onboarding schedule email (Edge Function). */
  const [onboardScheduleWhen2meetUrl, setOnboardScheduleWhen2meetUrl] = useState('')
  const [onboardScheduleDeadlineNote, setOnboardScheduleDeadlineNote] = useState('')
  const [hrReports, setHrReports] = useState([])
  const [hrReportFilter, setHrReportFilter] = useState('pending') // exec HR Reports default to Pending; 'all', 'pending', 'reviewed', 'resolved', 'dismissed'
  const [showHrReportModal, setShowHrReportModal] = useState(false)
  const [hrReportForm, setHrReportForm] = useState({
    nature: '',
    regardingMemberId: '',
    regardingName: '',
    regardingContact: '',
    dateOccurred: '',
    details: ''
  })
  const [hrReportError, setHrReportError] = useState('')
  const [hrReportSuccess, setHrReportSuccess] = useState('')
  const [selectedHrReport, setSelectedHrReport] = useState(null)
  const [showHrReportViewModal, setShowHrReportViewModal] = useState(false)
  const [memberStrikeRows, setMemberStrikeRows] = useState([])
  const [removalProposals, setRemovalProposals] = useState([])
  const [execResignations, setExecResignations] = useState([])
  const [myResignationRows, setMyResignationRows] = useState([])
  const [strikeModalMember, setStrikeModalMember] = useState(null)
  const [showStrikeModal, setShowStrikeModal] = useState(false)
  const [removalModalMember, setRemovalModalMember] = useState(null)
  const [showRemovalModal, setShowRemovalModal] = useState(false)
  const [showHonorableExitEmailModal, setShowHonorableExitEmailModal] = useState(false)
  const [showRemovalNoticeEmailModal, setShowRemovalNoticeEmailModal] = useState(false)
  const [showPolicyViolationEmailModal, setShowPolicyViolationEmailModal] = useState(false)
  const [policyViolationEmailSeed, setPolicyViolationEmailSeed] = useState({
    memberId: '',
    nature: '',
  })
  const [recordingHrStrike, setRecordingHrStrike] = useState(false)
  const [resignSubmitLoading, setResignSubmitLoading] = useState(false)
  const [myRequests, setMyRequests] = useState([])
  const [allMemberRequests, setAllMemberRequests] = useState([])
  const [memberRequestFilter, setMemberRequestFilter] = useState('pending') // 'all' | 'pending' | 'approved' | 'declined'
  const [memberRequestTeamFilter, setMemberRequestTeamFilter] = useState('all')
  const [leaveExtensionViewMode, setLeaveExtensionViewMode] = useState('calendar') // 'calendar' | 'table'
  const [calendarBirthdayRows, setCalendarBirthdayRows] = useState([])
  const [dashboardCalendarEvents, setDashboardCalendarEvents] = useState([])
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [requestForm, setRequestForm] = useState({
    type: 'leave',
    reason: '',
    leaveStart: '',
    leaveEnd: '',
    projectName: '',
    requestedByDate: ''
  })
  const [requestError, setRequestError] = useState('')
  const [requestSuccess, setRequestSuccess] = useState('')
  const [selectedRequestForReview, setSelectedRequestForReview] = useState(null)
  const [showRequestReviewModal, setShowRequestReviewModal] = useState(false)
  const [requestReviewNotes, setRequestReviewNotes] = useState('')
  const [requestReviewAction, setRequestReviewAction] = useState(null) // 'approve' | 'decline'
  const [selectedRequestForView, setSelectedRequestForView] = useState(null)
  const [showRequestViewModal, setShowRequestViewModal] = useState(false)
  const [mySuggestions, setMySuggestions] = useState([])
  const [allSuggestions, setAllSuggestions] = useState([])
  const [suggestionFilter, setSuggestionFilter] = useState('pending') // 'all' | 'pending' | 'under_review' | 'approved' | 'declined'
  /** Exec: filter by submission channel — public website vs internal member ideas */
  const [suggestionSourceFilter, setSuggestionSourceFilter] = useState('all') // 'all' | 'public' | 'internal'
  const [volunteerFilter, setVolunteerFilter] = useState('pending') // 'all' | 'pending' (waiting) | 'approved' | 'declined' (denied)
  const [suggestionForm, setSuggestionForm] = useState({ type: 'bill_idea', title: '', description: '' })
  const [suggestionError, setSuggestionError] = useState('')
  const [suggestionSuccess, setSuggestionSuccess] = useState('')
  const [showSuggestionViewModal, setShowSuggestionViewModal] = useState(false)
  const [selectedSuggestionForView, setSelectedSuggestionForView] = useState(null)
  const [suggestionReviewNotes, setSuggestionReviewNotes] = useState('')
  const [viewAsData, setViewAsData] = useState(null)
  const [viewAsLoading, setViewAsLoading] = useState(false)
  const [viewAsError, setViewAsError] = useState(null)
  const [partners, setPartners] = useState([])
  const [showPartnerModal, setShowPartnerModal] = useState(false)
  const [editingPartnerId, setEditingPartnerId] = useState(null)
  const [partnerForm, setPartnerForm] = useState({
    partnerName: '',
    websiteUrl: '',
    displayOrder: 999,
    active: true
  })
  const [partnerLogoFile, setPartnerLogoFile] = useState(null)
  const [partnerError, setPartnerError] = useState('')
  const [partnerSuccess, setPartnerSuccess] = useState('')
  const [schools, setSchools] = useState([])
  const [showSchoolModal, setShowSchoolModal] = useState(false)
  const [editingSchoolId, setEditingSchoolId] = useState(null)
  const [schoolForm, setSchoolForm] = useState({
    schoolName: '',
    displayOrder: 999,
    active: true
  })
  const [schoolLogoFile, setSchoolLogoFile] = useState(null)
  const [schoolError, setSchoolError] = useState('')
  const [schoolSuccess, setSchoolSuccess] = useState('')
  const [draggedSchoolId, setDraggedSchoolId] = useState(null)
  const [draggedPartnerId, setDraggedPartnerId] = useState(null)
  const [advisors, setAdvisors] = useState([])
  const [mentorAccountsByAdvisorId, setMentorAccountsByAdvisorId] = useState({})
  const [mentorCredentialsModal, setMentorCredentialsModal] = useState(null)
  const [mentorProvisionBusyId, setMentorProvisionBusyId] = useState(null)
  const [showAdvisorModal, setShowAdvisorModal] = useState(false)
  const [editingAdvisorId, setEditingAdvisorId] = useState(null)
  const [advisorForm, setAdvisorForm] = useState({
    fullName: '',
    title: '',
    company: '',
    linkedinUrl: '',
    displayOrder: 999,
    active: true,
  })
  const [advisorPhotoFile, setAdvisorPhotoFile] = useState(null)
  const [advisorError, setAdvisorError] = useState('')
  const [advisorSuccess, setAdvisorSuccess] = useState('')
  const [draggedAdvisorId, setDraggedAdvisorId] = useState(null)
  const [profilePicLoading, setProfilePicLoading] = useState(false)
  const [profilePicError, setProfilePicError] = useState('')
  const [profilePicSuccess, setProfilePicSuccess] = useState('')
  const [profilePicVersion, setProfilePicVersion] = useState(0) // cache-buster so browser shows new image after update
  const [preferredNameDraft, setPreferredNameDraft] = useState('')
  const [preferredNameEditOpen, setPreferredNameEditOpen] = useState(false)
  const [preferredNameSaving, setPreferredNameSaving] = useState(false)
  const [preferredNameError, setPreferredNameError] = useState('')
  const [preferredNameSuccess, setPreferredNameSuccess] = useState('')
  const profilePicInputRef = useRef(null)
  const [memberPhotoTarget, setMemberPhotoTarget] = useState(null)
  const [memberPhotoLoading, setMemberPhotoLoading] = useState(false)
  const [memberPhotoError, setMemberPhotoError] = useState('')
  const [memberPhotoSuccess, setMemberPhotoSuccess] = useState('')
  const execMemberPhotoInputRef = useRef(null)
  const [showVerificationModal, setShowVerificationModal] = useState(false)
  const [verificationPdfUrl, setVerificationPdfUrl] = useState(null)
  const [verificationPdfBase64, setVerificationPdfBase64] = useState(null)
  const [verificationMember, setVerificationMember] = useState(null)
  const [verificationApprovedEntries, setVerificationApprovedEntries] = useState([])
  const [selectedVerificationEntryIds, setSelectedVerificationEntryIds] = useState([])
  const [verificationEntryCount, setVerificationEntryCount] = useState(0)
  const [verificationPreviewDirty, setVerificationPreviewDirty] = useState(false)
  const [verificationSending, setVerificationSending] = useState(false)
  const [verificationGenerating, setVerificationGenerating] = useState(false)

  // Helper functions
  const formatDate = (dateStr) => {
    if (!dateStr) return '-'
    const [year, month, day] = dateStr.split('-').map(Number)
    const d = new Date(year, month - 1, day)
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }

  const formatPhone = (phone) => {
    if (!phone) return '-'
    const cleaned = ('' + phone).replace(/\D/g, '')
    const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/)
    return match ? `(${match[1]}) ${match[2]}-${match[3]}` : phone
  }

  const formatDuration = (start, end, hours = null) => {
    if (hours !== null && hours !== undefined) {
      // Hours-only mode
      const h = Math.floor(hours)
      const m = Math.round((hours - h) * 60)
      return m > 0 ? `${h}h ${m}m` : `${h}h`
    }
    // DateTime mode
    const ms = new Date(end) - new Date(start)
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    return `${h}h ${m}m`
  }

  const formatDateLong = (d) => {
    return new Date(d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
  }

  const shrinkText = (ctx, text, maxWidth, fontBase) => {
    let size = fontBase
    ctx.font = `${size}px ${ctx.fontFamily || 'sans-serif'}`
    while (ctx.measureText(text).width > maxWidth && size > 24) {
      size -= 2
      ctx.font = `${size}px ${ctx.fontFamily || 'sans-serif'}`
    }
    return size
  }

  // Helper function to check if member has a specific permission (uses viewed member when in view-as mode)
  const hasPermission = (permission) => {
    const m = viewAsData?.member ?? member
    if (!m) return false
    return m[permission] === true || m[permission] === 'true'
  }

  const isExec = useMemo(() => {
    const m = viewAsData?.member ?? member
    if (!m) return false
    return (
      (m.volunteer === true || m.volunteer === 'true') &&
      (m.applications === true || m.applications === 'true') &&
      (m.bills === true || m.bills === 'true') &&
      (m.registration === true || m.registration === 'true')
    )
  }, [member, viewAsData])

  const isTeamLeadUser = useMemo(() => {
    const m = viewAsData?.member ?? member
    if (!m?.member_id) return false
    const mid = String(m.member_id)
    return (policyTeams || []).some(
      (t) => t.active !== false && policyTeamLeadIds(t).includes(mid)
    )
  }, [member, viewAsData, policyTeams])

  /** Assignee dropdown: execs see all active members (policy + staff teams). Team leads see their team roster (bill filter only for policy teams). */
  const assigneePickerMembers = useMemo(() => {
    const allActive = (allMembersForManagement || []).filter((m) => m.active !== false)
    const billsMembers = (allMembersForManagement || []).filter(
      (m) => m.bills === true || m.bills === 'true'
    )
    if (isExec) return allActive
    if (!isTeamLeadUser) return billsMembers
    const subject = viewAsData?.member ?? member
    const ledTeams = (policyTeams || []).filter(
      (t) => t.active !== false && policyTeamLeadIds(t).includes(String(subject?.member_id))
    )
    if (ledTeams.length === 0) return billsMembers
    const allowed = new Set()
    for (const led of ledTeams) {
      const kind = led.team_kind || 'policy'
      for (const mpt of memberPolicyTeams || []) {
        if (String(mpt.team_id) !== String(led.team_id)) continue
        if (kind === 'policy') {
          const row = (allMembersForManagement || []).find(
            (x) => String(x.member_id) === String(mpt.member_id)
          )
          if (row && (row.bills === true || row.bills === 'true')) allowed.add(String(mpt.member_id))
        } else {
          allowed.add(String(mpt.member_id))
        }
      }
    }
    const fromMgmt = allActive.filter((m) => allowed.has(String(m.member_id)))
    if (fromMgmt.length > 0) return fromMgmt
    return (teamRosterMembers || []).filter((m) => allowed.has(String(m.member_id)))
  }, [
    allMembersForManagement,
    isExec,
    isTeamLeadUser,
    policyTeams,
    memberPolicyTeams,
    member,
    viewAsData,
    teamRosterMembers,
  ])

  const memberHasAssignmentWork = useMemo(() => {
    if (!member?.member_id || !(billAssignments || []).length) return false
    const mid = String(member.member_id)
    return billAssignments.some((a) => billAssignmentAssigneeIds(a).map(String).includes(mid))
  }, [member, billAssignments])

  const memberTeamNameById = useMemo(() => {
    const teamNameById = {}
    for (const t of policyTeams || []) {
      teamNameById[String(t.team_id)] = String(t.name || '').trim() || 'Unnamed team'
    }
    const out = {}
    for (const row of memberPolicyTeams || []) {
      const tid = String(row.team_id || '')
      out[String(row.member_id)] = teamNameById[tid] || 'Unassigned teams'
    }
    // Team leads may not appear on member_policy_teams; still tag them with teams they lead.
    for (const t of policyTeams || []) {
      if (t.active === false) continue
      const nm = teamNameById[String(t.team_id)] || 'Unassigned teams'
      for (const lid of policyTeamLeadIds(t)) {
        if (!lid) continue
        const key = String(lid)
        if (out[key] == null || out[key] === 'Unassigned teams') {
          out[key] = nm
        }
      }
    }
    return out
  }, [policyTeams, memberPolicyTeams])

  const calendarTeamNameById = useMemo(() => {
    const out = {}
    for (const t of policyTeams || []) {
      out[String(t.team_id)] = String(t.name || '').trim() || 'Unnamed team'
    }
    return out
  }, [policyTeams])

  const deadlineTeamOptions = useMemo(() => {
    const active = (policyTeams || []).filter((t) => t.active !== false)
    if (isExec) {
      return active.map((t) => ({ team_id: t.team_id, name: t.name || 'Unnamed team' }))
    }
    const mid = String(member?.member_id || '')
    return active
      .filter((t) => policyTeamLeadIds(t).includes(mid))
      .map((t) => ({ team_id: t.team_id, name: t.name || 'Unnamed team' }))
  }, [policyTeams, isExec, member])

  const canEditCalendarEvent = (ev) => {
    if (!ev || viewAsData) return false
    if (ev.kind === 'span_event') return isExec
    if (ev.kind === 'deadline') {
      if (isExec) return true
      const mid = String(member?.member_id || '')
      const team = (policyTeams || []).find((t) => String(t.team_id) === String(ev.team_id))
      return !!(team && policyTeamLeadIds(team).includes(mid))
    }
    return false
  }

  const assignmentTeamLabel = (assignment) => {
    const assigneeIds = billAssignmentAssigneeIds(assignment)
    if (!assigneeIds.length) return 'Open pool'
    const names = [...new Set(assigneeIds.map((id) => memberTeamNameById[String(id)] || 'Unassigned teams'))]
    if (names.length === 1) return names[0]
    return 'Multiple teams'
  }

  const computeAssignBillModalHidePrefill = useCallback(
    (forEdit, assignment) => {
      const subject = viewAsData?.member ?? member
      const mid = subject?.member_id != null ? String(subject.member_id) : ''

      if (isTeamLeadUser && !isExec) {
        const led = (policyTeams || []).filter(
          (t) => t.active !== false && policyTeamLeadIds(t).includes(mid)
        )
        if (led.length === 0) return false
        return !led.some((t) => (t.team_kind || 'policy') === 'policy')
      }

      if (forEdit && assignment) {
        const label = assignmentTeamLabel(assignment)
        if (label === 'Multiple teams' || label === 'Open pool') return false
        const team = (policyTeams || []).find((t) => String(t.name || '').trim() === label)
        if (team && (team.team_kind || 'policy') !== 'policy') return true
        return false
      }

      if (isExec && execAssignmentTeamFilter !== 'all') {
        const label = execAssignmentTeamFilter
        const team = (policyTeams || []).find((t) => String(t.name || '').trim() === label)
        if (team && (team.team_kind || 'policy') !== 'policy') return true
      }
      return false
    },
    [
      isTeamLeadUser,
      isExec,
      member,
      viewAsData,
      policyTeams,
      execAssignmentTeamFilter,
      assignmentTeamLabel,
    ]
  )

  // Load member data
  useEffect(() => {
    // Check if there's a hash in the URL (from invite link)
    const hasHash = window.location.hash && window.location.hash.length > 0
    
    // Set up auth state listener to handle invite link callbacks
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event, session ? 'session exists' : 'no session')
      // Handle various auth events that might occur from invite links
      // SIGNED_IN: User signs in (including from invite link)
      // TOKEN_REFRESHED: Session token refreshed (might happen on page load with hash)
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
        console.log('Session established, loading member data...')
        loadMemberData(false) // Don't skip redirect now that we have a session
      } else if (event === 'SIGNED_OUT') {
        console.log('User signed out, redirecting to login...')
        window.location.href = '/login.html'
      }
    })

    // Initial load - skip redirect if hash is present (wait for auth state change)
    loadMemberData(hasHash)
    loadAllMembers()

    // Cleanup subscription on unmount
    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Load additional data based on permissions after member is loaded
  useEffect(() => {
    if (!member) return

    if (member._isMentor) {
      if (hasPermission('bills')) {
        loadAllBills()
        loadResearchBills()
      }
      return
    }

    loadPolicyTeams()
    loadBillAssignments()
    if (hasPermission('bills')) {
      loadAllBills()
      loadResearchBills()
    }
    if (hasPermission('applications')) {
      loadApplications()
    }
    if (hasPermission('registration')) {
      loadAllMembersForManagement()
    }
    if (hasPermission('volunteer') && hasPermission('applications') && hasPermission('bills') && hasPermission('registration')) {
      loadHrReports()
      loadExecConductData()
      loadAllMemberRequests()
      loadAllSuggestions()
      loadSchools()
      loadPartners()
      loadAdvisors()
    } else {
      loadMyHrReports()
    }
    loadMyRequests()
    loadMySuggestions()
    loadCalendarBirthdays()
    loadDashboardCalendarEvents()
    loadMyResignations()
  }, [member, viewAsData])

  // View-as mode: when URL has ?viewAs=member_id and current user is exec, fetch that member's dashboard
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const viewAsId = params.get('viewAs')
    if (!viewAsId || !member) {
      if (!viewAsId) {
        setViewAsData(null)
        setViewAsError(null)
      }
      return
    }
    const isExec = (member.volunteer === true || member.volunteer === 'true') &&
      (member.applications === true || member.applications === 'true') &&
      (member.bills === true || member.bills === 'true') &&
      (member.registration === true || member.registration === 'true')
    if (!isExec) {
      setViewAsError('Only executive directors can view another member\'s dashboard.')
      setViewAsData(null)
      return
    }
    setViewAsError(null)
    setViewAsLoading(true)
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const url = `${supabaseUrl}/functions/v1/view-member-dashboard?member_id=${encodeURIComponent(viewAsId)}`
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) {
        setViewAsError('Please sign in again.')
        setViewAsLoading(false)
        return
      }
      fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
        .then((res) => {
          if (res.status === 403) {
            setViewAsError('You don\'t have permission to view this dashboard.')
            return null
          }
          if (res.status === 404) {
            setViewAsError('Member not found.')
            return null
          }
          if (!res.ok) throw new Error('Failed to load dashboard')
          return res.json()
        })
        .then((data) => {
          setViewAsData(data || null)
        })
        .catch(() => setViewAsError('Could not load dashboard.'))
        .finally(() => setViewAsLoading(false))
    })
  }, [member])

  useEffect(() => {
    const m = viewAsData?.member ?? member
    if (!m?.member_id) {
      setPreferredNameDraft('')
      return
    }
    setPreferredNameDraft(m.preferred_name ?? '')
  }, [member?.member_id, member?.preferred_name, viewAsData?.member?.member_id, viewAsData?.member?.preferred_name])

  useEffect(() => {
    if (viewAsData) setPreferredNameEditOpen(false)
  }, [viewAsData])

  // Draft inputs for assignee deliverable fields (preserve typing when list refreshes)
  useEffect(() => {
    const assigneeId = viewAsData?.member?.member_id ?? member?.member_id
    if (!assigneeId) return
    setMemberDeliverableInputs((prev) => {
      const next = {}
      for (const a of billAssignments) {
        if (!billAssignmentAssigneeIds(a).includes(assigneeId)) continue
        const existing = prev[a.assignment_id]
        if (existing) {
          next[a.assignment_id] = existing
        } else {
          next[a.assignment_id] = {
            doc: a.deliverable_doc_link || '',
            pdf: a.deliverable_pdf_url || '',
          }
        }
      }
      return next
    })
  }, [billAssignments, member?.member_id, viewAsData?.member?.member_id])

  // Load all members for collaborator selection
  const loadAllMembers = async () => {
    const { data: membersData, error } = await supabase
      .from('members')
      .select('member_id, first_name, last_name')
      .order('last_name', { ascending: true })

    if (error) {
      console.error('Error loading members:', error)
      return
    }

    setAllMembers(membersData || [])
  }

  // Load all members for management (registration permission required)
  const loadAllMembersForManagement = async () => {
    const { data: membersData, error } = await supabase
      .from('members')
      .select('*')
      .order('last_name', { ascending: true })

    if (error) {
      console.error('Error loading members for management:', error)
      return
    }

    setAllMembersForManagement(membersData || [])
  }

  // Load all bills for management (executive directors only)
  const loadAllBills = async () => {
    const { data: billsData, error } = await supabase
      .from('bills')
      .select('*')
      .order('bill_date', { ascending: false })

    if (error) {
      console.error('Error loading bills:', error)
      return
    }

    const billsWithPDF = (billsData || []).map((bill) => enrichBillWithStoredPdf(bill))
    setAllBills(billsWithPDF)
  }

  function getBillPdfUrl(bill) {
    if (!bill) return null
    if (bill.pdfUrl) return bill.pdfUrl
    if (bill.proposal_pdf_url) return bill.proposal_pdf_url
    const built = buildCanonicalProposalPdf(bill.state, bill.name)
    return built?.publicUrl || null
  }


  const loadBillAssignments = async () => {
    const { data: rows, error } = await supabase
      .from('bill_assignments')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error loading bill assignments:', error)
      return
    }

    const assigneeMap = {}
    const { data: joinRows, error: joinErr } = await supabase
      .from('bill_assignment_assignees')
      .select('assignment_id, member_id')

    if (!joinErr && joinRows?.length) {
      for (const r of joinRows) {
        if (!assigneeMap[r.assignment_id]) assigneeMap[r.assignment_id] = []
        assigneeMap[r.assignment_id].push({ member_id: r.member_id })
      }
    } else if (joinErr) {
      console.warn('Could not load bill_assignment_assignees (run migrations if needed):', joinErr.message)
    }

    const merged = (rows || []).map((a) => {
      let nested = assigneeMap[a.assignment_id] || []
      if (nested.length === 0 && a.assignee_member_id) {
        nested = [{ member_id: a.assignee_member_id }]
      }
      return { ...a, bill_assignment_assignees: nested }
    })
    setBillAssignments(merged)
  }

  /** Replace junction rows (exec); empty list = no assignees (pool). */
  const replaceAssignmentAssignees = async (assignmentId, memberIds) => {
    const uniq = [...new Set((memberIds || []).filter(Boolean))]
    const { error: delErr } = await supabase
      .from('bill_assignment_assignees')
      .delete()
      .eq('assignment_id', assignmentId)
    if (delErr) throw new Error(delErr.message || 'Could not update assignees.')
    if (uniq.length === 0) return
    const { error: insErr } = await supabase.from('bill_assignment_assignees').insert(
      uniq.map((member_id) => ({ assignment_id: assignmentId, member_id }))
    )
    if (insErr) throw new Error(insErr.message || 'Could not set assignees.')
  }

  /** Safe columns only (no review_notes); requires get_bills_research() migration. */
  const loadResearchBills = async () => {
    setResearchBillsLoading(true)
    setResearchBillsError('')
    const { data, error } = await supabase.rpc('get_bills_research')
    if (error) {
      console.error('Error loading research bills:', error)
      setResearchBillsError(error.message || 'Could not load research data.')
      setResearchBills([])
      setResearchBillsLoading(false)
      return
    }
    const raw = (data || []).filter((b) => b.status !== 'outreach_only')
    const billsWithPDF = raw.map((bill) => enrichBillWithStoredPdf(bill))
    setResearchBills(billsWithPDF)
    setResearchBillsLoading(false)
  }

  // Load all applications (executive directors only)
  const loadApplications = async () => {
    const { data: applicationsData, error } = await supabase
      .from('applications')
      .select('*')
      .order('submitted_at', { ascending: false })

    if (error) {
      console.error('Error loading applications:', error)
      return
    }

    setApplications(applicationsData || [])
  }

  // Load all partners
  const loadPartners = async () => {
    const { data: partnersData, error } = await supabase
      .from('partners')
      .select('*')
      .order('display_order', { ascending: true })

    if (error) {
      console.error('Error loading partners:', error)
      return
    }

    setPartners(partnersData || [])
  }

  // Load all schools
  const loadSchools = async () => {
    const { data: schoolsData, error } = await supabase
      .from('schools')
      .select('*')
      .order('display_order', { ascending: true })

    if (error) {
      console.error('Error loading schools:', error)
      return
    }

    setSchools(schoolsData || [])
  }

  const loadAdvisors = async () => {
    const { data, error } = await supabase
      .from('advisors')
      .select('*')
      .order('display_order', { ascending: true })
      .order('full_name', { ascending: true })

    if (error) {
      console.error('Error loading advisors:', error)
      return
    }

    setAdvisors(data || [])

    const { data: mentorRows, error: mentorErr } = await supabase
      .from('mentor_accounts')
      .select('mentor_account_id, advisor_id, username, login_email, active, provisioned_at')
    if (mentorErr) {
      console.warn('Mentor accounts load skipped:', mentorErr.message)
      setMentorAccountsByAdvisorId({})
      return
    }
    const map = {}
    ;(mentorRows || []).forEach((row) => {
      map[row.advisor_id] = row
    })
    setMentorAccountsByAdvisorId(map)
  }

  // Load HR reports (executive directors only, filtered to exclude reports about themselves)
  const loadHrReports = async () => {
    if (!member) return
    
    const { data: reportsData, error } = await supabase
      .from('hr_reports')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error loading HR reports:', error)
      return
    }
    
    // Fetch member details for submitted_by and regarding_member_id
    if (reportsData && reportsData.length > 0) {
      const memberIds = new Set()
      reportsData.forEach(report => {
        if (report.submitted_by) memberIds.add(report.submitted_by)
        if (report.regarding_member_id) memberIds.add(report.regarding_member_id)
      })
      
      if (memberIds.size > 0) {
        const { data: membersData } = await supabase
          .from('members')
          .select('member_id, first_name, last_name, email')
          .in('member_id', Array.from(memberIds))
        
        const membersMap = {}
        if (membersData) {
          membersData.forEach(m => {
            membersMap[m.member_id] = m
          })
        }
        
        // Attach member data to reports
        reportsData.forEach(report => {
          report.submitted_by_member = membersMap[report.submitted_by]
          report.regarding_member = membersMap[report.regarding_member_id]
        })
      }
    }

    // Filter out reports about the current member (if they're an exec director)
    const filtered = (reportsData || []).filter(report => {
      // If the report is about the current member, exclude it
      if (report.regarding_member_id === member.member_id) {
        return false
      }
      return true
    })

    setHrReports(filtered)
  }

  const loadExecConductData = async () => {
    if (!member) return
    const isExecUser =
      (member.volunteer === true || member.volunteer === 'true') &&
      (member.applications === true || member.applications === 'true') &&
      (member.bills === true || member.bills === 'true') &&
      (member.registration === true || member.registration === 'true')
    if (!isExecUser) return

    const [s, p, r] = await Promise.all([
      supabase.from('member_strikes').select('*').order('created_at', { ascending: false }),
      supabase.from('member_removal_proposals').select('*').order('created_at', { ascending: false }),
      supabase.from('member_resignations').select('*').order('created_at', { ascending: false }),
    ])
    if (s.error) console.error('member_strikes', s.error)
    else setMemberStrikeRows(s.data || [])
    if (p.error) console.error('member_removal_proposals', p.error)
    else setRemovalProposals(p.data || [])
    if (r.error) console.error('member_resignations', r.error)
    else setExecResignations(r.data || [])
  }

  const loadMyResignations = async () => {
    if (!member?.member_id) return
    const { data, error } = await supabase
      .from('member_resignations')
      .select('*')
      .eq('member_id', member.member_id)
      .order('created_at', { ascending: false })
    if (error) {
      console.error('member_resignations load', error)
      return
    }
    setMyResignationRows(data || [])
  }

  // Load current member's own HR reports only (for non-execs)
  const loadMyHrReports = async () => {
    if (!member?.member_id) return
    const { data: reportsData, error } = await supabase
      .from('hr_reports')
      .select('*')
      .eq('submitted_by', member.member_id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error loading my HR reports:', error)
      setHrReports([])
      return
    }

    if (reportsData && reportsData.length > 0) {
      const memberIds = new Set()
      reportsData.forEach(report => {
        if (report.submitted_by) memberIds.add(report.submitted_by)
        if (report.regarding_member_id) memberIds.add(report.regarding_member_id)
      })
      if (memberIds.size > 0) {
        const { data: membersData } = await supabase
          .from('members')
          .select('member_id, first_name, last_name, email')
          .in('member_id', Array.from(memberIds))
        const membersMap = {}
        if (membersData) membersData.forEach(m => { membersMap[m.member_id] = m })
        reportsData.forEach(report => {
          report.submitted_by_member = membersMap[report.submitted_by]
          report.regarding_member = membersMap[report.regarding_member_id]
        })
      }
    }
    setHrReports(reportsData || [])
  }

  // Load current member's leave/extension requests
  const loadMyRequests = async () => {
    if (!member?.member_id) return
    const { data, error } = await supabase
      .from('member_requests')
      .select('*')
      .eq('member_id', member.member_id)
      .order('created_at', { ascending: false })
    if (error) {
      console.error('Error loading my requests:', error)
      setMyRequests([])
      return
    }
    if (data && data.length > 0) {
      const reviewerIds = [...new Set(data.map(r => r.reviewed_by).filter(Boolean))]
      if (reviewerIds.length > 0) {
        const { data: reviewersData } = await supabase
          .from('members')
          .select('member_id, first_name, last_name')
          .in('member_id', reviewerIds)
        const reviewersMap = {}
        if (reviewersData) reviewersData.forEach(m => { reviewersMap[m.member_id] = m })
        data.forEach(r => { r.reviewed_by_member = r.reviewed_by ? reviewersMap[r.reviewed_by] : null })
      }
    }
    setMyRequests(data || [])
  }

  // Load all member requests (execs only)
  const loadAllMemberRequests = async () => {
    if (!member) return
    const { data, error } = await supabase
      .from('member_requests')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('Error loading member requests:', error)
      setAllMemberRequests([])
      return
    }
    if (data && data.length > 0) {
      const memberIds = [...new Set(data.map(r => r.member_id))]
      const reviewerIds = [...new Set(data.map(r => r.reviewed_by).filter(Boolean))]
      const allIds = [...new Set([...memberIds, ...reviewerIds])]
      const { data: membersData } = await supabase
        .from('members')
        .select('member_id, first_name, last_name, email')
        .in('member_id', allIds)
      const membersMap = {}
      if (membersData) membersData.forEach(m => { membersMap[m.member_id] = m })
      data.forEach(r => {
        r.member = membersMap[r.member_id]
        r.reviewed_by_member = r.reviewed_by ? membersMap[r.reviewed_by] : null
      })
    }
    setAllMemberRequests(data || [])
  }

  const loadCalendarBirthdays = async () => {
    const { data, error } = await supabase.rpc('list_active_member_birthdays')
    if (error) {
      console.error('list_active_member_birthdays', error)
      setCalendarBirthdayRows([])
      return
    }
    setCalendarBirthdayRows(data || [])
  }

  const loadDashboardCalendarEvents = async () => {
    const { data, error } = await supabase
      .from('dashboard_calendar_events')
      .select('*')
      .order('start_date', { ascending: true })
    if (error) {
      console.error('dashboard_calendar_events', error)
      setDashboardCalendarEvents([])
      return
    }
    setDashboardCalendarEvents(data || [])
  }

  const handleSaveCalendarEvent = async (payload) => {
    if (!payload?.title || !payload?.start_date || !payload?.kind) return false
    try {
      const row = {
        kind: payload.kind,
        title: payload.title,
        start_date: payload.start_date,
        end_date: payload.kind === 'span_event' ? payload.end_date || null : null,
        team_id: payload.kind === 'deadline' ? payload.team_id : null,
        updated_at: new Date().toISOString(),
      }
      if (payload.event_id) {
        const { error } = await supabase
          .from('dashboard_calendar_events')
          .update(row)
          .eq('event_id', payload.event_id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('dashboard_calendar_events').insert({
          ...row,
          created_by: member?.member_id || null,
        })
        if (error) throw error
      }
      await loadDashboardCalendarEvents()
      return true
    } catch (err) {
      alert(err.message || 'Failed to save calendar item.')
      return false
    }
  }

  const handleDeleteCalendarEvent = async (ev) => {
    if (!ev?.event_id) return false
    if (!window.confirm(`Delete “${ev.title || 'this item'}”?`)) return false
    try {
      const { error } = await supabase
        .from('dashboard_calendar_events')
        .delete()
        .eq('event_id', ev.event_id)
      if (error) throw error
      await loadDashboardCalendarEvents()
      return true
    } catch (err) {
      alert(err.message || 'Failed to delete calendar item.')
      return false
    }
  }

  const loadPolicyTeams = async () => {
    const { data: teams, error: e1 } = await supabase.from('policy_teams').select('*').order('name')
    const { data: mpt, error: e2 } = await supabase.from('member_policy_teams').select('member_id, team_id')
    const { data: leadRows, error: e3 } = await supabase.from('policy_team_leads').select('team_id, member_id')
    if (e1) console.error('policy_teams', e1)
    if (e2) console.error('member_policy_teams', e2)
    if (e3) console.error('policy_team_leads', e3)
    const byTeam = {}
    for (const r of leadRows || []) {
      const tid = String(r.team_id)
      if (!byTeam[tid]) byTeam[tid] = []
      byTeam[tid].push(r.member_id)
    }
    const merged = (teams || []).map((t) => ({
      ...t,
      lead_member_ids: byTeam[String(t.team_id)] || [],
    }))
    setPolicyTeams(merged)
    setMemberPolicyTeams(mpt || [])
  }

  useEffect(() => {
    if (!member || viewAsData) return
    if (isExec) return
    if (!isTeamLeadUser) return
    loadAllMemberRequests()
  }, [member, viewAsData, isTeamLeadUser, isExec])

  useEffect(() => {
    let cancelled = false
    async function loadTeamRoster() {
      const subject = viewAsData?.member ?? member
      if (!subject?.member_id || viewAsData) {
        if (!cancelled) setTeamRosterMembers([])
        return
      }
      if (isExec) {
        if (!cancelled) setTeamRosterMembers([])
        return
      }
      const ledTeams = (policyTeams || []).filter(
        (t) => t.active !== false && policyTeamLeadIds(t).includes(String(subject.member_id))
      )
      if (ledTeams.length === 0) {
        if (!cancelled) setTeamRosterMembers([])
        return
      }
      const idSet = new Set()
      for (const led of ledTeams) {
        for (const mpt of memberPolicyTeams || []) {
          if (String(mpt.team_id) === String(led.team_id)) idSet.add(mpt.member_id)
        }
      }
      const ids = [...idSet]
      if (ids.length === 0) {
        if (!cancelled) setTeamRosterMembers([])
        return
      }
      const { data, error } = await supabase
        .from('members')
        .select('member_id, first_name, last_name, email, bills, role, active')
        .in('member_id', ids)
      if (error) console.error('team roster load', error)
      if (!cancelled) {
        setTeamRosterMembers((data || []).filter((m) => m.active !== false))
      }
    }
    loadTeamRoster()
    return () => {
      cancelled = true
    }
  }, [member, viewAsData, isExec, policyTeams, memberPolicyTeams])

  const loadMySuggestions = async () => {
    if (!member?.member_id) return
    const { data, error } = await supabase
      .from('member_suggestions')
      .select('*')
      .eq('member_id', member.member_id)
      .order('created_at', { ascending: false })
    if (error) {
      console.error('Error loading my suggestions:', error)
      setMySuggestions([])
      return
    }
    const rows = data || []
    const reviewerIds = [...new Set(rows.map((s) => s.reviewed_by).filter(Boolean))]
    if (reviewerIds.length > 0) {
      const { data: reviewersData } = await supabase
        .from('members')
        .select('member_id, first_name, last_name, email')
        .in('member_id', reviewerIds)
      const reviewersMap = {}
      if (reviewersData) reviewersData.forEach((m) => { reviewersMap[m.member_id] = m })
      rows.forEach((s) => {
        s._source = 'member'
        s.reviewed_by_member = s.reviewed_by ? reviewersMap[s.reviewed_by] : null
      })
    } else {
      rows.forEach((s) => { s._source = 'member' })
    }
    setMySuggestions(rows)
  }

  const loadAllSuggestions = async () => {
    if (!member) return
    const { data, error } = await supabase
      .from('member_suggestions')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('Error loading suggestions:', error)
      setAllSuggestions([])
      return
    }
    const memberRows = data || []
    if (memberRows.length > 0) {
      const memberIds = [...new Set(memberRows.map(s => s.member_id))]
      const reviewerIds = [...new Set(memberRows.map(s => s.reviewed_by).filter(Boolean))]
      const allIds = [...new Set([...memberIds, ...reviewerIds])]
      const { data: membersData } = await supabase
        .from('members')
        .select('member_id, first_name, last_name, email')
        .in('member_id', allIds)
      const membersMap = {}
      if (membersData) membersData.forEach(m => { membersMap[m.member_id] = m })
      memberRows.forEach(s => {
        s._source = 'member'
        s.member = membersMap[s.member_id]
        s.reviewed_by_member = s.reviewed_by ? membersMap[s.reviewed_by] : null
      })
    }

    const isExecUser =
      hasPermission('volunteer') &&
      hasPermission('applications') &&
      hasPermission('bills') &&
      hasPermission('registration')
    if (!isExecUser) {
      setAllSuggestions(memberRows)
      return
    }

    const { data: pubData, error: pubErr } = await supabase
      .from('public_bill_recommendations')
      .select('*')
      .order('created_at', { ascending: false })
    if (pubErr) {
      console.error('Error loading public bill recommendations:', pubErr)
      setAllSuggestions(memberRows)
      return
    }
    const publicRows = pubData || []
    if (publicRows.length > 0) {
      const reviewerIds = [...new Set(publicRows.map((r) => r.reviewed_by).filter(Boolean))]
      let reviewersMap = {}
      if (reviewerIds.length > 0) {
        const { data: revData } = await supabase
          .from('members')
          .select('member_id, first_name, last_name, email')
          .in('member_id', reviewerIds)
        if (revData) revData.forEach((m) => { reviewersMap[m.member_id] = m })
      }
      publicRows.forEach((r) => {
        r._source = 'public_bill'
        r.suggestion_id = r.recommendation_id
        r.type = 'public_bill_website'
        r.reviewed_by_member = r.reviewed_by ? reviewersMap[r.reviewed_by] : null
      })
    }

    const merged = [...memberRows, ...publicRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    setAllSuggestions(merged)
  }

  // HR Report handlers
  const handleSubmitHrReport = async () => {
    const { nature, regardingMemberId, regardingName, regardingContact, dateOccurred, details } =
      hrReportForm
    setHrReportError('')
    setHrReportSuccess('')

    // Validation
    if (!nature || !dateOccurred) {
      setHrReportError('Nature of complaint and date occurred are required.')
      return
    }

    const isOther = regardingMemberId === '__other__'
    if (isOther && !String(regardingName || '').trim()) {
      setHrReportError('Enter a name for Other (person not in the directory).')
      return
    }

    if (!member) {
      setHrReportError('Member data not loaded.')
      return
    }

    const resolvedMemberId =
      regardingMemberId && !isOther ? regardingMemberId : null
    const resolvedName = isOther
      ? regardingName.trim()
      : resolvedMemberId
        ? null
        : regardingName.trim() || null
    const resolvedContact = isOther ? String(regardingContact || '').trim() || null : null

    try {
      const { data, error } = await supabase
        .from('hr_reports')
        .insert({
          submitted_by: member.member_id,
          nature_of_complaint: nature.trim(),
          regarding_member_id: resolvedMemberId,
          regarding_name: resolvedName,
          regarding_contact: resolvedContact,
          date_occurred: dateOccurred,
          details: details.trim() || null
        })
        .select()
        .single()

      if (error) {
        console.error('Error submitting HR report:', error)
        setHrReportError('Failed to submit report. ' + error.message)
        return
      }

      let leadershipEmailed = false
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const base = import.meta.env.VITE_SUPABASE_URL
        if (session?.access_token && data?.report_id && base) {
          const resp = await fetch(`${base.replace(/\/$/, '')}/functions/v1/notify-hr-report`, {
            method: 'POST',
            headers: supabaseInvokeHeaders(session.access_token),
            body: JSON.stringify({ report_id: data.report_id }),
          })
          leadershipEmailed = resp.ok
          if (!resp.ok) {
            const errBody = await resp.json().catch(() => ({}))
            console.warn('HR report notify email failed:', resp.status, errBody)
          }
        }
      } catch (notifyErr) {
        console.warn('HR report notify email error:', notifyErr)
      }

      setHrReportSuccess(
        leadershipEmailed
          ? 'HR report submitted. Leadership has been notified by email.'
          : 'HR report submitted. Leadership may not have been emailed — please tell an executive director if needed.'
      )
      setHrReportForm({
        nature: '',
        regardingMemberId: '',
        regardingName: '',
        regardingContact: '',
        dateOccurred: '',
        details: ''
      })
      
      // Refresh reports if user has permission to view them
      if (hasPermission('registration')) {
        await loadHrReports()
      }
      
      // Close modal after 3 seconds
      setTimeout(() => {
        setShowHrReportModal(false)
        setHrReportSuccess('')
      }, 3000)
    } catch (err) {
      console.error('Error submitting HR report:', err)
      setHrReportError(err.message || 'Failed to submit report.')
    }
  }

  // Update HR report status (and optional resolution / incident notes via review_notes)
  const handleUpdateHrReportStatus = async (reportId, newStatus, reviewNotes) => {
    if (!member) {
      console.error('No member data available')
      return
    }

    console.log('Updating HR report status:', { reportId, newStatus, memberId: member.member_id })

    try {
      const payload = {
        status: newStatus,
        reviewed_by: member.member_id,
        reviewed_at: new Date().toISOString(),
      }
      if (reviewNotes !== undefined) {
        payload.review_notes = String(reviewNotes || '').trim() || null
      }

      const { data: updateResult, error } = await supabase
        .from('hr_reports')
        .update(payload)
        .eq('report_id', reportId)
        .select()

      if (error) {
        console.error('Error updating HR report status:', error)
        alert('Failed to update report status: ' + error.message)
        return
      }

      console.log('Update result:', updateResult)

      if (!updateResult || updateResult.length === 0) {
        console.error('Update returned no rows - RLS policy may be blocking the update')
        alert('Failed to update report status. You may not have permission to update this report.')
        return
      }

      console.log('Status updated in database, fetching updated report...')

      // Small delay to ensure database commit
      await new Promise(resolve => setTimeout(resolve, 100))

      // Fetch the updated report with all related data
      const { data: updatedReportData, error: fetchError } = await supabase
        .from('hr_reports')
        .select('*')
        .eq('report_id', reportId)
        .single()

      if (fetchError) {
        console.error('Error fetching updated report:', fetchError)
      } else if (updatedReportData) {
        console.log('Fetched updated report:', updatedReportData)
        
        // Fetch member details
        const memberIds = new Set()
        if (updatedReportData.submitted_by) memberIds.add(updatedReportData.submitted_by)
        if (updatedReportData.regarding_member_id) memberIds.add(updatedReportData.regarding_member_id)
        if (updatedReportData.reviewed_by) memberIds.add(updatedReportData.reviewed_by)
        
        if (memberIds.size > 0) {
          const { data: membersData } = await supabase
            .from('members')
            .select('member_id, first_name, last_name, email')
            .in('member_id', Array.from(memberIds))
          
          const membersMap = {}
          if (membersData) {
            membersData.forEach(m => {
              membersMap[m.member_id] = m
            })
          }
          
          updatedReportData.submitted_by_member = membersMap[updatedReportData.submitted_by]
          updatedReportData.regarding_member = membersMap[updatedReportData.regarding_member_id]
          updatedReportData.reviewed_by_member = membersMap[updatedReportData.reviewed_by]
        }
        
        console.log('Setting selectedHrReport to:', updatedReportData)
        setSelectedHrReport(updatedReportData)
      }

      // Refresh reports to get updated data
      await loadHrReports()
      
      // If the new status doesn't match the current filter, switch to "all" to show the updated report
      if (hrReportFilter !== 'all' && hrReportFilter !== newStatus) {
        setHrReportFilter('all')
      }
    } catch (err) {
      console.error('Error updating HR report status:', err)
      alert('Failed to update report status.')
    }
  }

  const handleRecordStrikeFromHrReport = async (report) => {
    if (!report?.regarding_member_id || !member?.member_id) return
    setRecordingHrStrike(true)
    try {
      const { error } = await supabase.from('member_strikes').insert({
        member_id: report.regarding_member_id,
        source: 'hr_report',
        hr_report_id: report.report_id,
        notes: `HR report: ${(report.nature_of_complaint || '').slice(0, 400)}`,
        recorded_by: member.member_id,
      })
      if (error) {
        if (error.code === '23505' || String(error.message || '').includes('duplicate')) {
          alert('A strike is already linked to this HR report.')
        } else {
          throw error
        }
        return
      }
      await loadExecConductData()
      alert('Strike recorded for the member named in this report.')
    } catch (err) {
      alert(err.message || 'Could not record strike.')
    } finally {
      setRecordingHrStrike(false)
    }
  }

  const handleAddManualStrike = async (notes) => {
    if (!strikeModalMember || !member?.member_id) return
    const { error } = await supabase.from('member_strikes').insert({
      member_id: strikeModalMember.member_id,
      source: 'manual',
      hr_report_id: null,
      notes: notes || null,
      recorded_by: member.member_id,
    })
    if (error) {
      alert(error.message || 'Could not add strike.')
      return
    }
    await loadExecConductData()
  }

  const handleDeleteHrReport = async (reportId) => {
    if (!reportId) return false
    if (
      !window.confirm(
        'Delete this HR report permanently? Linked strikes stay on record but lose the report link. This cannot be undone.',
      )
    ) {
      return false
    }
    try {
      const { error } = await supabase.from('hr_reports').delete().eq('report_id', reportId)
      if (error) throw error
      setShowHrReportViewModal(false)
      setSelectedHrReport(null)
      await loadHrReports()
      await loadExecConductData()
      return true
    } catch (err) {
      alert(err.message || 'Failed to delete HR report.')
      return false
    }
  }

  const handleDeleteResignation = async (resignationId) => {
    if (!resignationId) return false
    if (!window.confirm('Delete this resignation request permanently? This cannot be undone.')) return false
    try {
      const { error } = await supabase
        .from('member_resignations')
        .delete()
        .eq('resignation_id', resignationId)
      if (error) throw error
      await loadExecConductData()
      return true
    } catch (err) {
      alert(err.message || 'Failed to delete resignation request.')
      return false
    }
  }

  const handleDeleteStrike = async (strikeId) => {
    if (!confirm('Remove this strike from the record?')) return false
    const { error } = await supabase.from('member_strikes').delete().eq('strike_id', strikeId)
    if (error) {
      alert(error.message)
      return false
    }
    await loadExecConductData()
    return true
  }

  const toggleDashboardTheme = () => {
    setDashboardTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(DASHBOARD_THEME_KEY, next)
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const handleInitiateRemovalProposal = async () => {
    if (!removalModalMember || !member?.member_id) return
    const { error } = await supabase.from('member_removal_proposals').insert({
      member_id: removalModalMember.member_id,
      initiated_by: member.member_id,
      status: 'awaiting_second',
    })
    if (error) {
      if (error.code === '23505') {
        alert('A removal proposal is already pending for this member. Use the banner above or cancel it first.')
      } else {
        alert(error.message || 'Could not save removal proposal.')
      }
      return
    }
    await loadExecConductData()
    alert('First executive confirmation recorded. Another executive must confirm before this is treated as final.')
    setShowRemovalModal(false)
    setRemovalModalMember(null)
  }

  const handleSecondExecRemovalConfirm = async (proposal) => {
    if (!proposal?.proposal_id || !member?.member_id) return
    if (String(proposal.initiated_by) === String(member.member_id)) {
      alert('A different executive must provide the second confirmation.')
      return
    }
    const { error } = await supabase
      .from('member_removal_proposals')
      .update({
        confirmed_by: member.member_id,
        status: 'dual_confirmed',
        updated_at: new Date().toISOString(),
      })
      .eq('proposal_id', proposal.proposal_id)
      .eq('status', 'awaiting_second')
    if (error) {
      alert(error.message || 'Update failed.')
      return
    }
    await loadExecConductData()
    alert('Dual executive confirmation recorded. Use Executive Conduct to remove them from the directory when ready.')
    setShowRemovalModal(false)
    setRemovalModalMember(null)
  }

  const handleCancelRemovalProposal = async (proposal) => {
    if (!proposal?.proposal_id) return
    const { error } = await supabase
      .from('member_removal_proposals')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('proposal_id', proposal.proposal_id)
    if (error) {
      alert(error.message)
      return
    }
    await loadExecConductData()
  }

  const handleSubmitResignationRequest = async (message) => {
    if (!member?.member_id) return
    setResignSubmitLoading(true)
    try {
      const { data, error } = await supabase
        .from('member_resignations')
        .insert({
          member_id: member.member_id,
          message,
          status: 'requested',
        })
        .select()
        .single()
      if (error) throw error
      const base = import.meta.env.VITE_SUPABASE_URL
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (session?.access_token && data?.resignation_id && base) {
        const resp = await fetch(
          `${base.replace(/\/$/, '')}/functions/v1/notify-resignation-request`,
          {
            method: 'POST',
            headers: supabaseInvokeHeaders(session.access_token),
            body: JSON.stringify({ resignation_id: data.resignation_id }),
          }
        )
        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({}))
          console.warn('Resignation notify email failed:', resp.status, errBody)
          alert(
            'Request saved, but emailing directors failed. Please contact leadership directly.'
          )
        }
      }
      await loadMyResignations()
      await loadExecConductData()
    } catch (err) {
      alert(err.message || 'Could not submit resignation request.')
    } finally {
      setResignSubmitLoading(false)
    }
  }

  const handleWithdrawResignation = async () => {
    const row = (myResignationRows || []).find(
      (r) => !['withdrawn', 'honorable_letter_sent', 'completed'].includes(r.status)
    )
    if (!row?.resignation_id) return
    const { error } = await supabase
      .from('member_resignations')
      .update({
        status: 'withdrawn',
        updated_at: new Date().toISOString(),
      })
      .eq('resignation_id', row.resignation_id)
    if (error) {
      alert(error.message)
      return
    }
    await loadMyResignations()
    await loadExecConductData()
  }

  const handleUpdateResignationStatus = async (resignationId, status) => {
    const { error } = await supabase
      .from('member_resignations')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('resignation_id', resignationId)
    if (error) {
      alert(error.message)
      return
    }
    await loadExecConductData()
  }

  const handleUpdateResignationExecNotes = async (resignationId, execNotes) => {
    const { error } = await supabase
      .from('member_resignations')
      .update({
        exec_notes: execNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('resignation_id', resignationId)
    if (error) {
      alert(error.message)
      return
    }
    await loadExecConductData()
  }

  /** Hide member from public directory (active = false). Does not delete account or credited work. */
  const handleDeactivateMemberFromDirectory = async (memberId) => {
    if (!memberId) return false
    const row = (allMembersForManagement || []).find((m) => String(m.member_id) === String(memberId))
    const name = row
      ? `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'this member'
      : 'this member'
    if (
      !window.confirm(
        `Remove ${name} from the public directory?\n\nThey will be marked inactive and no longer appear on the site. Prior credited work stays. This does not delete their account.`
      )
    ) {
      return false
    }
    try {
      // Direct update avoids ambiguous update_member overloads when only p_active is passed.
      // DB trigger also clears team rows; these deletes cover envs before that migration runs.
      const { error } = await supabase
        .from('members')
        .update({ active: false })
        .eq('member_id', memberId)
      if (error) throw error
      await Promise.all([
        supabase.from('member_policy_teams').delete().eq('member_id', memberId),
        supabase.from('policy_team_leads').delete().eq('member_id', memberId),
      ])
      await loadAllMembersForManagement()
      await loadAllMembers()
      await loadPolicyTeams()
      return true
    } catch (err) {
      alert(err.message || 'Failed to remove member from directory.')
      return false
    }
  }

  // In view-as mode, show only reports submitted by the viewed member; otherwise use full list (or own for non-exec)
  const effectiveHrReports = viewAsData?.member
    ? hrReports.filter(r => r.submitted_by === viewAsData.member.member_id)
    : hrReports
  // Filter HR reports by status
  const filteredHrReports = effectiveHrReports.filter(report => {
    if (hrReportFilter === 'all') return true
    return report.status === hrReportFilter
  })

  // Submit leave or extension request
  const handleSubmitRequest = async (e) => {
    e?.preventDefault()
    setRequestError('')
    setRequestSuccess('')
    if (!member?.member_id) {
      setRequestError('Member data not loaded.')
      return
    }
    const reason = (requestForm.reason || '').trim()
    if (!reason) {
      setRequestError('Please provide a reason.')
      return
    }
    try {
      const payload = {
        member_id: member.member_id,
        type: requestForm.type,
        reason,
        leave_start: requestForm.leaveStart || null,
        leave_end: requestForm.leaveEnd || null,
        project_name: requestForm.projectName?.trim() || null,
        requested_by_date: requestForm.requestedByDate || null
      }
      const { error } = await supabase.from('member_requests').insert(payload)
      if (error) throw error
      setRequestSuccess('Request submitted. Executive directors will review it.')
      setRequestForm({ type: 'leave', reason: '', leaveStart: '', leaveEnd: '', projectName: '', requestedByDate: '' })
      setShowRequestModal(false)
      await loadMyRequests()
      if (isExec || isTeamLeadUser) await loadAllMemberRequests()
    } catch (err) {
      setRequestError(err.message || 'Failed to submit request.')
    }
  }

  const openRequestReviewModal = (request, action) => {
    setSelectedRequestForReview(request)
    setRequestReviewAction(action)
    setRequestReviewNotes(request?.review_notes || '')
    setShowRequestReviewModal(true)
  }

  const handleRequestReviewSubmit = async () => {
    if (!selectedRequestForReview || !requestReviewAction || !member?.member_id) return
    try {
      const { error } = await supabase
        .from('member_requests')
        .update({
          status: requestReviewAction === 'approve' ? 'approved' : 'declined',
          reviewed_by: member.member_id,
          reviewed_at: new Date().toISOString(),
          review_notes: requestReviewNotes.trim() || null
        })
        .eq('request_id', selectedRequestForReview.request_id)
      if (error) throw error
      setShowRequestReviewModal(false)
      setSelectedRequestForReview(null)
      setRequestReviewNotes('')
      await loadAllMemberRequests()
      await loadMyRequests()
    } catch (err) {
      alert(err.message || 'Failed to update request.')
    }
  }

  const openRequestViewModal = (request) => {
    setSelectedRequestForView(request)
    setRequestReviewNotes(request?.review_notes || '')
    setShowRequestViewModal(true)
  }

  const handleRequestReviewSubmitFromView = async (action) => {
    if (!selectedRequestForView || !member?.member_id) return
    try {
      const { error } = await supabase
        .from('member_requests')
        .update({
          status: action === 'approve' ? 'approved' : 'declined',
          reviewed_by: member.member_id,
          reviewed_at: new Date().toISOString(),
          review_notes: requestReviewNotes.trim() || null
        })
        .eq('request_id', selectedRequestForView.request_id)
      if (error) throw error
      setShowRequestViewModal(false)
      setSelectedRequestForView(null)
      setRequestReviewNotes('')
      await loadAllMemberRequests()
      await loadMyRequests()
    } catch (err) {
      alert(err.message || 'Failed to update request.')
    }
  }

  const handleRequestStatusChangeFromView = async (newStatus) => {
    if (!selectedRequestForView || !member?.member_id) return
    try {
      const payload = {
        status: newStatus,
        review_notes: requestReviewNotes.trim() || null
      }
      if (newStatus === 'pending') {
        payload.reviewed_by = null
        payload.reviewed_at = null
      } else {
        payload.reviewed_by = member.member_id
        payload.reviewed_at = new Date().toISOString()
      }
      const { error } = await supabase
        .from('member_requests')
        .update(payload)
        .eq('request_id', selectedRequestForView.request_id)
      if (error) throw error
      setShowRequestViewModal(false)
      setSelectedRequestForView(null)
      setRequestReviewNotes('')
      await loadAllMemberRequests()
      await loadMyRequests()
    } catch (err) {
      alert(err.message || 'Failed to update request.')
    }
  }

  const handleDeleteRequestFromView = async () => {
    if (!selectedRequestForView?.request_id) return
    const target = selectedRequestForView
    const label = target.member
      ? `${target.member.first_name || ''} ${target.member.last_name || ''}`.trim() || 'this member'
      : 'this request'
    if (!window.confirm(`Delete this ${target.type || 'leave'} request for ${label}? This cannot be undone.`)) return
    try {
      const { error } = await supabase
        .from('member_requests')
        .delete()
        .eq('request_id', target.request_id)
      if (error) throw error
      setShowRequestViewModal(false)
      setSelectedRequestForView(null)
      setRequestReviewNotes('')
      await loadAllMemberRequests()
      await loadMyRequests()
    } catch (err) {
      alert(err.message || 'Failed to delete request.')
    }
  }

  const handleSubmitSuggestion = async (e) => {
    e?.preventDefault()
    setSuggestionError('')
    setSuggestionSuccess('')
    const { type, title, description } = suggestionForm
    if (!title?.trim()) {
      setSuggestionError('Title is required.')
      return
    }
    if (!member?.member_id) {
      setSuggestionError('Member data not loaded.')
      return
    }
    try {
      const { error } = await supabase
        .from('member_suggestions')
        .insert({
          member_id: member.member_id,
          type,
          title: title.trim(),
          description: description?.trim() || null
        })
      if (error) throw error
      setSuggestionSuccess('Suggestion submitted. Execs will review it.')
      setSuggestionForm({ type: 'bill_idea', title: '', description: '' })
      await loadMySuggestions()
      if (hasPermission('volunteer') && hasPermission('applications') && hasPermission('bills') && hasPermission('registration')) {
        await loadAllSuggestions()
      }
    } catch (err) {
      setSuggestionError(err.message || 'Failed to submit suggestion.')
    }
  }

  const enrichSuggestionForView = async (suggestion) => {
    if (!suggestion) return suggestion
    if (suggestion._source === 'public_bill') {
      const { data, error } = await supabase
        .from('public_bill_recommendations')
        .select('*')
        .eq('recommendation_id', suggestion.recommendation_id)
        .single()
      if (error || !data) return suggestion
      const fresh = { ...data, _source: 'public_bill', suggestion_id: data.recommendation_id, type: 'public_bill_website' }
      if (data.reviewed_by) {
        const { data: reviewer } = await supabase
          .from('members')
          .select('member_id, first_name, last_name, email')
          .eq('member_id', data.reviewed_by)
          .single()
        fresh.reviewed_by_member = reviewer || null
      }
      return fresh
    }

    const { data, error } = await supabase
      .from('member_suggestions')
      .select('*')
      .eq('suggestion_id', suggestion.suggestion_id)
      .single()
    if (error || !data) return suggestion

    const fresh = { ...data, _source: 'member' }
    if (suggestion.member) fresh.member = suggestion.member
    if (data.reviewed_by) {
      const { data: reviewer } = await supabase
        .from('members')
        .select('member_id, first_name, last_name, email')
        .eq('member_id', data.reviewed_by)
        .single()
      fresh.reviewed_by_member = reviewer || null
    }
    return fresh
  }

  const openSuggestionViewModal = async (suggestion) => {
    const fresh = await enrichSuggestionForView(suggestion)
    setSelectedSuggestionForView(fresh)
    setSuggestionReviewNotes(fresh?.review_notes || '')
    setShowSuggestionViewModal(true)
  }

  const handleSuggestionCommentSave = async () => {
    if (!selectedSuggestionForView || !member?.member_id) return
    try {
      const notes = suggestionReviewNotes.trim() || null
      const payload = { review_notes: notes }
      if (notes) {
        payload.reviewed_by = member.member_id
        payload.reviewed_at = new Date().toISOString()
      }
      const isPublic = selectedSuggestionForView._source === 'public_bill'
      const { error } = isPublic
        ? await supabase
            .from('public_bill_recommendations')
            .update(payload)
            .eq('recommendation_id', selectedSuggestionForView.recommendation_id)
        : await supabase
            .from('member_suggestions')
            .update(payload)
            .eq('suggestion_id', selectedSuggestionForView.suggestion_id)
      if (error) throw error
      const updated = await enrichSuggestionForView(selectedSuggestionForView)
      setSelectedSuggestionForView(updated)
      setSuggestionReviewNotes(updated?.review_notes || '')
      await loadMySuggestions()
      await loadAllSuggestions()
    } catch (err) {
      alert(err.message || 'Failed to save comment.')
    }
  }

  const handleSuggestionStatusChangeFromView = async (newStatus) => {
    if (!selectedSuggestionForView || !member?.member_id) return
    try {
      const payload = {
        status: newStatus,
        review_notes: suggestionReviewNotes.trim() || null
      }
      if (newStatus === 'pending') {
        payload.reviewed_by = null
        payload.reviewed_at = null
      } else {
        payload.reviewed_by = member.member_id
        payload.reviewed_at = new Date().toISOString()
      }
      const isPublic = selectedSuggestionForView._source === 'public_bill'
      const { error } = isPublic
        ? await supabase
            .from('public_bill_recommendations')
            .update(payload)
            .eq('recommendation_id', selectedSuggestionForView.recommendation_id)
        : await supabase
        .from('member_suggestions')
        .update(payload)
        .eq('suggestion_id', selectedSuggestionForView.suggestion_id)
      if (error) throw error
      setShowSuggestionViewModal(false)
      setSelectedSuggestionForView(null)
      setSuggestionReviewNotes('')
      await loadMySuggestions()
      await loadAllSuggestions()
    } catch (err) {
      alert(err.message || 'Failed to update suggestion.')
    }
  }

  const filteredMemberRequests = allMemberRequests.filter((r) => {
    if (memberRequestFilter !== 'all' && r.status !== memberRequestFilter) return false
    // Team leads only ever see their team (RLS); no team dropdown — do not apply team filter.
    if (isTeamLeadUser && !isExec) return true
    if (memberRequestTeamFilter === 'all') return true
    return (memberTeamNameById[String(r.member_id)] || 'Unassigned teams') === memberRequestTeamFilter
  })

  const assignmentTeamFilterOptions = useMemo(() => {
    const names = new Set()
    for (const a of billAssignments || []) {
      names.add(assignmentTeamLabel(a))
    }
    return ['all', ...Array.from(names).sort((a, b) => a.localeCompare(b))]
  }, [billAssignments, assignmentTeamLabel])

  const memberRequestTeamFilterOptions = useMemo(() => {
    const names = new Set()
    for (const r of allMemberRequests || []) {
      names.add(memberTeamNameById[String(r.member_id)] || 'Unassigned teams')
    }
    return ['all', ...Array.from(names).sort((a, b) => a.localeCompare(b))]
  }, [allMemberRequests, memberTeamNameById])

  const filteredSuggestions = allSuggestions.filter((s) => {
    if (suggestionFilter !== 'all' && s.status !== suggestionFilter) return false
    if (suggestionSourceFilter === 'all') return true
    if (suggestionSourceFilter === 'public') return s._source === 'public_bill'
    return s._source !== 'public_bill'
  })

  const isTeamLeadOnly = isTeamLeadUser && !isExec
  const isMentor = !!member?._isMentor
  const effectiveSuggestions = viewAsData ? [] : (isExec ? filteredSuggestions : mySuggestions)
  const dashboardOrder = isMentor
    ? {
        billSubmission: 1,
        changePassword: 2,
        yourInfo: 99,
        leaveExtension: 99,
        billManagement: 99,
        applications: 99,
        ideasSuggestions: 99,
        volunteerHours: 99,
        hrReports: 99,
        execConduct: 99,
        memberManagement: 99,
        schoolsPartners: 99,
        classroom: 99,
        analytics: 99,
        mediumBlog: 99,
        resignFromSpan: 99,
      }
    : isExec
    ? {
        yourInfo: 1,
        leaveExtension: 2,
        billManagement: 3,
        applications: 4,
        ideasSuggestions: 5,
        volunteerHours: 6,
        hrReports: 7,
        execConduct: 8,
        memberManagement: 9,
        schoolsPartners: 10,
        classroom: 11,
        analytics: 12,
        mediumBlog: 13,
        changePassword: 14,
        resignFromSpan: 15,
        billSubmission: 99,
      }
    : isTeamLeadOnly
      ? {
          yourInfo: 1,
          leaveExtension: 2,
          billManagement: 3,
          billSubmission: 4,
          volunteerHours: 5,
          ideasSuggestions: 6,
          classroom: 7,
          hrReports: 8,
          mediumBlog: 9,
          changePassword: 10,
          resignFromSpan: 11,
          applications: 99,
          memberManagement: 99,
          schoolsPartners: 99,
          analytics: 99,
          execConduct: 99,
        }
      : {
          yourInfo: 1,
          leaveExtension: 2,
          billSubmission: 3,
          volunteerHours: 4,
          ideasSuggestions: 5,
          classroom: 6,
          hrReports: 7,
          mediumBlog: 8,
          changePassword: 9,
          resignFromSpan: 10,
          billManagement: 99,
          applications: 99,
          memberManagement: 99,
          schoolsPartners: 99,
          analytics: 99,
          execConduct: 99,
        }

  const dashboardSectionNavItems = useMemo(() => {
    if (viewAsData || !member?.registration_complete) return []

    const perm = (p) => {
      const v = member[p]
      return v === true || v === 'true'
    }
    const execUser = perm('volunteer') && perm('applications') && perm('bills') && perm('registration')
    const teamLeadOnly = isTeamLeadUser && !execUser
    const showBillManagement = execUser || (teamLeadOnly && perm('bills'))
    const showBillSubmission = (perm('bills') || memberHasAssignmentWork) && !execUser

    const visibility = {
      yourInfo: !isMentor,
      leaveExtension: !isMentor,
      billManagement: showBillManagement && !isMentor,
      billSubmission: isMentor ? true : showBillSubmission,
      applications: perm('applications') && !isMentor,
      ideasSuggestions: !isMentor,
      volunteerHours: !isMentor,
      hrReports: !isMentor,
      execConduct: execUser && !isMentor,
      memberManagement: perm('registration') && !isMentor,
      schoolsPartners: execUser && !isMentor,
      classroom: execUser && !isMentor,
      analytics: execUser && !isMentor,
      mediumBlog: perm('blog') && !isMentor,
      changePassword: true,
      resignFromSpan: !isMentor,
    }

    const labelOverrides = {}
    if (isMentor) {
      labelOverrides.billSubmission = 'Policy tools'
    }
    if (teamLeadOnly && showBillManagement) {
      labelOverrides.billManagement = 'Team — Assigned work'
    }

    return buildDashboardSectionNavItems(dashboardOrder, visibility, labelOverrides)
  }, [viewAsData, member, isTeamLeadUser, memberHasAssignmentWork, dashboardOrder, isMentor])

  const strikeCountByMember = useMemo(() => {
    const m = {}
    for (const s of memberStrikeRows) {
      m[s.member_id] = (m[s.member_id] || 0) + 1
    }
    return m
  }, [memberStrikeRows])

  const activeResignation = useMemo(
    () => (myResignationRows || []).find((r) => r.status !== 'withdrawn'),
    [myResignationRows]
  )

  const strikesForStrikeModal = useMemo(() => {
    if (!strikeModalMember) return []
    return memberStrikeRows.filter((s) => s.member_id === strikeModalMember.member_id)
  }, [memberStrikeRows, strikeModalMember])

  const membersByIdForConduct = useMemo(() => {
    const o = {}
    for (const row of allMembersForManagement || []) {
      o[row.member_id] = row
    }
    return o
  }, [allMembersForManagement])

  const pendingRemovalForRemovalModal = useMemo(() => {
    if (!removalModalMember) return null
    return (removalProposals || []).find(
      (p) =>
        p.member_id === removalModalMember.member_id && p.status === 'awaiting_second'
    )
  }, [removalModalMember, removalProposals])

  const memberAtStrikeLimitRow = useCallback(
    (mrow) => {
      const c = strikeCountByMember[mrow.member_id] || 0
      return isAtStrikeLimit(mrow, c)
    },
    [strikeCountByMember]
  )

  const loadMemberData = async (skipRedirect = false) => {
    try {
      console.log('Loading member data...')
      
      // Check if there's a hash in the URL (from invite link callback)
      // Supabase processes these automatically, but we should wait a bit for it to complete
      const hasHash = window.location.hash && window.location.hash.length > 0
      if (hasHash) {
        console.log('Detected URL hash (likely from invite link), waiting for auth processing...')
        // Wait a moment for Supabase to process the hash
        await new Promise(resolve => setTimeout(resolve, 1000))
        // Clear the hash from URL after processing
        if (window.history.replaceState) {
          window.history.replaceState(null, '', window.location.pathname + window.location.search)
        }
      }
      
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      
      if (sessionError) {
        console.error('Session error:', sessionError)
        setLoading(false)
        return
      }
      
      if (!session) {
        // Don't redirect if we're waiting for hash processing (skipRedirect = true)
        // The onAuthStateChange listener will handle it
        if (!skipRedirect && !hasHash) {
          console.log('No session, redirecting to login')
          window.location.href = '/login.html'
        } else if (hasHash) {
          console.log('No session yet, but hash detected - waiting for auth state change...')
        }
        setLoading(false)
        return
      }

      const userId = session.user.id
      const email = session.user.email
      console.log('Fetching member data for user_id:', userId, 'email:', email)
      
      // Try to fetch by user_id first (more reliable), fallback to email if user_id is null
      let memberData = null
      let error = null
      
      if (userId) {
        const { data, error: userIdError } = await supabase
          .from('members')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle()
        memberData = data
        error = userIdError
        
        // If not found by user_id, try email as fallback
        if (!memberData && !error) {
          console.log('Member not found by user_id, trying email...')
          const { data: emailData, error: emailError } = await supabase
            .from('members')
            .select('*')
            .eq('email', email)
            .maybeSingle()
          memberData = emailData
          error = emailError
        }
      } else {
        // No user_id, fallback to email
        console.log('No user_id in session, using email lookup')
        const { data: emailData, error: emailError } = await supabase
          .from('members')
          .select('*')
          .eq('email', email)
          .maybeSingle()
        memberData = emailData
        error = emailError
      }

      if (error) {
        console.error('Error fetching member data:', error)
        console.error('Error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        })
        setLoading(false)
        setMember(null) // Explicitly set to null to show error message
        return
      }

      if (!memberData) {
        console.log('No chapter member record; checking mentor / classroom…')
        try {
          const mentorSession = await getMentorSession()
          const synthetic = syntheticMemberFromMentorSession(mentorSession)
          if (synthetic) {
            setMember(synthetic)
            setMemberBillSectionTab('outreach')
            setLoading(false)
            return
          }
        } catch (mentorErr) {
          console.warn('Mentor session check failed:', mentorErr)
        }
        try {
          const classroomRole = await getClassroomSessionRole()
          if (classroomRole?.role) {
            window.location.href = '/classroom/dashboard.html'
            return
          }
        } catch (classroomErr) {
          console.warn('Classroom role check failed:', classroomErr)
        }
        console.error('No member data found for user_id:', userId, 'email:', email)
        setLoading(false)
        setMember(null)
        return
      }

      console.log('Member data loaded:', {
        email: memberData.email,
        registration_complete: memberData.registration_complete,
        volunteer: memberData.volunteer,
        applications: memberData.applications,
        bills: memberData.bills,
        registration: memberData.registration
      })
      
      setMember(memberData)
      setLoading(false)
      loadVolunteerEntries(memberData)
    } catch (err) {
      console.error('Unexpected error in loadMemberData:', err)
      setLoading(false)
    }
  }

  // Profile picture change
  const handleProfilePicClick = () => {
    profilePicInputRef.current?.click()
  }

  const handleProfilePicChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !member?.member_id) return

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) {
      setProfilePicError('Please choose a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfilePicError('Image must be under 5 MB.')
      return
    }

    setProfilePicError('')
    setProfilePicSuccess('')
    setProfilePicLoading(true)

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const filename = `${member.member_id}.${ext}`

    try {
      const { error: uploadError } = await supabase.storage
        .from('members-images')
        .upload(filename, file, { cacheControl: '3600', upsert: true })

      if (uploadError) {
        setProfilePicError('Failed to upload image: ' + uploadError.message)
        setProfilePicLoading(false)
        e.target.value = ''
        return
      }

      const { data: updateData, error: updateError } = await supabase.rpc('update_own_member_image', { filename })

      if (updateError) {
        setProfilePicError('Failed to update profile: ' + updateError.message)
        setProfilePicLoading(false)
        e.target.value = ''
        return
      }

      // If RPC returns rows_updated and it's 0, the DB row wasn't matched (e.g. user_id/email not linked)
      if (updateData === 0) {
        setProfilePicError('Profile could not be updated: your account may not be linked to a member record. Please contact an admin.')
        setProfilePicLoading(false)
        e.target.value = ''
        return
      }

      setMember(prev => prev ? { ...prev, image: filename } : null)
      setProfilePicVersion(Date.now()) // force img to reload (same URL would show cached old image)
      setProfilePicSuccess('Profile picture updated.')
      setProfilePicLoading(false)
      e.target.value = ''
      setTimeout(() => setProfilePicSuccess(''), 3000)
    } catch (err) {
      setProfilePicError(err.message || 'Failed to update profile picture.')
      setProfilePicLoading(false)
      e.target.value = ''
    }
  }

  const handleSavePreferredPublicName = async () => {
    if (viewAsData || !member?.member_id) return
    setPreferredNameError('')
    setPreferredNameSuccess('')
    setPreferredNameSaving(true)
    try {
      const v = preferredNameDraft.trim() || null
      const { error } = await supabase.from('members').update({ preferred_name: v }).eq('member_id', member.member_id)
      if (error) throw error
      setMember((prev) => (prev ? { ...prev, preferred_name: v } : null))
      setPreferredNameEditOpen(false)
      setPreferredNameSuccess('Preferred name saved.')
      setTimeout(() => setPreferredNameSuccess(''), 3000)
    } catch (err) {
      setPreferredNameError(err.message || 'Could not save preferred name.')
    } finally {
      setPreferredNameSaving(false)
    }
  }

  const handleCancelPreferredNameEdit = () => {
    setPreferredNameDraft(member?.preferred_name ?? '')
    setPreferredNameEditOpen(false)
    setPreferredNameError('')
    setPreferredNameSuccess('')
  }

  const handleMemberInfoUpdated = (patch) => {
    setMember((prev) => (prev ? { ...prev, ...patch } : null))
  }

  // Exec: change a member's profile picture (Member Management)
  const handleExecChangeMemberPhoto = (memberItem) => {
    setMemberPhotoTarget(memberItem.member_id)
    setMemberPhotoError('')
    setMemberPhotoSuccess('')
    execMemberPhotoInputRef.current?.click()
  }

  const handleExecMemberPhotoFileChange = async (e) => {
    const file = e.target.files?.[0]
    const targetId = memberPhotoTarget
    if (!file || !targetId) {
      e.target.value = ''
      setMemberPhotoTarget(null)
      return
    }

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) {
      setMemberPhotoError('Please choose a JPEG, PNG, or WebP image.')
      e.target.value = ''
      setMemberPhotoTarget(null)
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setMemberPhotoError('Image must be under 5 MB.')
      e.target.value = ''
      setMemberPhotoTarget(null)
      return
    }

    setMemberPhotoError('')
    setMemberPhotoSuccess('')
    setMemberPhotoLoading(true)

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const filename = `${targetId}.${ext}`

    try {
      const { error: uploadError } = await supabase.storage
        .from('members-images')
        .upload(filename, file, { cacheControl: '3600', upsert: true })

      if (uploadError) {
        setMemberPhotoError('Failed to upload: ' + uploadError.message)
        setMemberPhotoLoading(false)
        e.target.value = ''
        setMemberPhotoTarget(null)
        return
      }

      const { error: updateError } = await supabase
        .from('members')
        .update({ image: filename })
        .eq('member_id', targetId)

      if (updateError) {
        setMemberPhotoError('Failed to update member: ' + updateError.message)
        setMemberPhotoLoading(false)
        e.target.value = ''
        setMemberPhotoTarget(null)
        return
      }

      setAllMembersForManagement(prev =>
        prev.map(m => m.member_id === targetId ? { ...m, image: filename } : m)
      )
      setMemberPhotoSuccess('Profile picture updated.')
      setMemberPhotoLoading(false)
      e.target.value = ''
      setMemberPhotoTarget(null)
      setTimeout(() => setMemberPhotoSuccess(''), 3000)
    } catch (err) {
      setMemberPhotoError(err.message || 'Failed to update profile picture.')
      setMemberPhotoLoading(false)
      e.target.value = ''
      setMemberPhotoTarget(null)
    }
  }

  // Load volunteer entries
  const loadVolunteerEntries = async (memberData) => {
    if (!memberData) return

    // Query volunteer entries
    const { data: entries, error } = await supabase
      .from('volunteers')
      .select('*')
      .order('start_timestamp', { ascending: false })

    if (error) {
      console.error('Error loading volunteer entries:', error)
      setVolunteerEntries([])
      return
    }
    
    // If we have entries, fetch member data separately
    if (entries && entries.length > 0) {
      const memberIds = [...new Set(entries.map(e => e.member_id))]
      const reviewedByIds = [...new Set(entries.map(e => e.reviewed_by).filter(Boolean))]
      const allMemberIds = [...new Set([...memberIds, ...reviewedByIds])]
      const { data: membersData, error: membersError } = await supabase
        .from('members')
        .select('member_id, first_name, last_name, image, email')
        .in('member_id', allMemberIds)
      
      if (membersError) {
        console.error('Error fetching members:', membersError)
      }
      
      // Map members to entries
      const membersMap = {}
      if (membersData) {
        membersData.forEach(m => {
          membersMap[m.member_id] = m
        })
      }
      
      // Add member data to each entry
      entries.forEach(entry => {
        entry.members = membersMap[entry.member_id] || {}
        entry.reviewed_by_member = entry.reviewed_by ? (membersMap[entry.reviewed_by] ?? null) : null
      })
    }

    // Filter entries - members with volunteer permission see all, others see only their own
    const canManageVolunteers = memberData.volunteer === true || memberData.volunteer === 'true'
    const filtered = entries.filter(e => 
      canManageVolunteers || e.member_id === memberData.member_id
    )

    setVolunteerEntries(filtered || [])
  }

  // Password change
  const handlePasswordChange = async (e) => {
    e.preventDefault()
    setPasswordMessage('')

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordMessage('Passwords do not match.')
      return
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword
      })
      if (error) throw error
      setPasswordMessage('Password updated successfully!')
      setPasswordForm({ newPassword: '', confirmPassword: '' })
      setVerifiedPassword(passwordForm.newPassword)
    } catch (err) {
      setPasswordMessage(err.message || 'Failed to update password.')
    }
  }

  const handleMediumOtpArm = async () => {
    setMediumOtpError('')
    setMediumOtpSuccess('')
    setMediumOtpLoading(true)
    try {
      const base = import.meta.env.VITE_SUPABASE_URL
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
      if (!base || !anon) throw new Error('App configuration error.')
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not signed in.')
      const res = await fetch(`${base.replace(/\/$/, '')}/functions/v1/medium-otp-arm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: anon,
        },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not start Medium forward.')
      setMediumOtpSuccess(
        'Forward is armed for ~10 minutes. On Medium, sign in with spanationwide@gmail.com; the login email will be sent to your SPAN address.',
      )
    } catch (err) {
      setMediumOtpError(err.message || 'Something went wrong.')
    } finally {
      setMediumOtpLoading(false)
    }
  }

  // SPANCard generation
  const handleDownloadSpanCard = () => {
    if (!member) return
    setQrPassword('')
    setQrPasswordError('')
    setShowPasswordModal(true)
  }

  const handleQrPasswordConfirm = async () => {
    const password = qrPassword.trim() || verifiedPassword
    if (!password) {
      setQrPasswordError('Password required.')
      return
    }

    setQrPasswordError('')
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: member.email,
        password
      })
      if (error) {
        setQrPasswordError('Incorrect password.')
        return
      }
      setShowPasswordModal(false)
      setVerifiedPassword(password)
      const timestamp = new Date().toISOString()
      await generateSpanCard(password, timestamp)
    } catch (err) {
      setQrPasswordError('Error verifying password.')
    }
  }

  const generateSpanCard = async (password, timestamp) => {
    if (!member) return

    const canvas = document.createElement('canvas')
    canvas.width = 2160
    canvas.height = 1200
    const ctx = canvas.getContext('2d')
    ctx.fontFamily = window.getComputedStyle(document.body).fontFamily || 'sans-serif'

    const loadImage = (src) => new Promise(res => {
      if (!src) return res(null)
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = src
      img.onload = () => res(img)
      img.onerror = () => res(null)
    })

    const [bgImage, profileImage] = await Promise.all([
      loadImage('/images/misc/SPANCard.jpg'),
      loadImage(member.image
        ? `${IMAGE_BASE_URL}/${member.image}`
        : null)
    ])

    // Background
    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height)
    } else {
      ctx.fillStyle = '#16213e'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }

    // Left half content area
    const leftW = canvas.width / 2
    const padding = 100

    // Profile circle
    if (profileImage) {
      const pSize = 250
      const pX = padding
      const pY = 250
      ctx.save()
      ctx.beginPath()
      ctx.arc(pX + pSize / 2, pY + pSize / 2, pSize / 2, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(profileImage, pX, pY, pSize, pSize)
      ctx.restore()
    }

    // Text content
    const textX = padding
    let y = 600
    ctx.fillStyle = '#fff'
    ctx.shadowColor = 'rgba(0,0,0,0.3)'
    ctx.shadowBlur = 10

    const fullName = memberLegalName(member) || `${member.first_name} ${member.last_name}`
    const fontSize = shrinkText(ctx, fullName, leftW - 2 * padding, 100)
    ctx.font = `bold ${fontSize}px ${ctx.fontFamily}`
    ctx.fillText(fullName, textX, y)
    y += fontSize + 20

    ctx.shadowColor = 'transparent'
    ctx.fillStyle = '#fdf0d5'
    ctx.font = `600 72px ${ctx.fontFamily}`
    ctx.fillText(member.role || '', textX, y)
    y += 80

    ctx.fillStyle = '#fff'
    ctx.font = `500 56px ${ctx.fontFamily}`
    ctx.fillText(member.school_name || '', textX, y)
    y += 80

    ctx.font = `300 48px ${ctx.fontFamily}`
    if (member.city || member.state) {
      ctx.fillText(
        `${member.city || ''}${member.city && member.state ? ', ' : ''}${member.state || ''}`,
        textX, y
      )
    }
    y += 60
    if (member.phone) ctx.fillText(formatPhone(member.phone), textX, y)
    y += 60
    if (member.email) ctx.fillText(member.email, textX, y)
    y += 60
    if (member.start_date) ctx.fillText(`Member since ${formatDate(member.start_date)}`, textX, y)

    // QR Code on right half
    const qrSize = 600
    const qrX = leftW + (leftW - qrSize) / 2
    const qrY = (canvas.height - qrSize) / 2 + 75

    // Draw translucent rounded box
    const boxPadding = 40
    const boxX = qrX - boxPadding
    const boxY = qrY - boxPadding
    const boxW = qrSize + boxPadding * 2
    const boxH = qrSize + boxPadding * 2

    ctx.save()
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.lineWidth = 4
    ctx.beginPath()
    const r = 24
    ctx.moveTo(boxX + r, boxY)
    ctx.lineTo(boxX + boxW - r, boxY)
    ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + r)
    ctx.lineTo(boxX + boxW, boxY + boxH - r)
    ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH)
    ctx.lineTo(boxX + r, boxY + boxH)
    ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - r)
    ctx.lineTo(boxX, boxY + r)
    ctx.quadraticCurveTo(boxX, boxY, boxX + r, boxY)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()

    // Generate QR code
    const qrPayload = JSON.stringify({
      email: member.email,
      password,
      timestamp
    })

    const QRCode = (await import('qrcode')).default
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      width: qrSize,
      color: { dark: '#000000', light: '#ffffff' },
      margin: 0
    })

    const qrImg = await loadImage(qrDataUrl)
    if (qrImg) ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize)

    // Download image
    const link = document.createElement('a')
    link.download = `${member.first_name}_${member.last_name}_SPANCard.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  // Volunteer hours management
  const handleAddVolunteer = () => {
    setVolunteerForm({ 
      jobTitle: '', 
      jobDesc: '', 
      startTime: '', 
      endTime: '',
      inputMode: 'datetime',
      hours: '',
      workDate: ''
    })
    setVolunteerError('')
    setShowVolunteerModal(true)
  }

  const handleSaveVolunteer = async () => {
    const { jobTitle, jobDesc, startTime, endTime, inputMode, hours, workDate } = volunteerForm
    setVolunteerError('')

    if (!jobTitle || !jobDesc) {
      setVolunteerError('Job title and description are required.')
      return
    }

    let startTimeObj, endTimeObj

    if (inputMode === 'hours') {
      // Hours-only mode
      if (!hours || !workDate) {
        setVolunteerError('Hours and work date are required.')
        return
      }

      const hoursNum = parseFloat(hours)
      if (isNaN(hoursNum) || hoursNum <= 0) {
        setVolunteerError('Hours must be a positive number.')
        return
      }

      // Set start time to the work date at 00:00
      const workDateObj = new Date(workDate)
      workDateObj.setHours(0, 0, 0, 0)
      startTimeObj = workDateObj

      // Set end time to start time + hours
      endTimeObj = new Date(startTimeObj.getTime() + hoursNum * 3600000)
    } else {
      // DateTime mode
      if (!startTime || !endTime) {
        setVolunteerError('Start time and end time are required.')
        return
      }

      startTimeObj = new Date(startTime)
      endTimeObj = new Date(endTime)
      if (endTimeObj <= startTimeObj) {
        setVolunteerError('End time must be after start time.')
        return
      }
    }

    try {
      const { error } = await supabase.from('volunteers').insert([{
        volunteering_job_title: jobTitle,
        volunteering_job_desc: jobDesc,
        start_timestamp: startTimeObj.toISOString(),
        end_timestamp: endTimeObj.toISOString(),
        request_submit_timestamp: new Date().toISOString(),
        member_id: member.member_id,
        approved: 'waiting',
        supervisor_comment: ''
      }])

      if (error) throw error
      setShowVolunteerModal(false)
      await loadVolunteerEntries(member)
    } catch (err) {
      setVolunteerError(err.message || 'Failed to save entry.')
    }
  }

  const handleApproveEntry = async (entryId) => {
    if (!member?.member_id) return
    await supabase.from('volunteers').update({
      approved: 'approved',
      reviewed_by: member.member_id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', entryId)
    await loadVolunteerEntries(member)
  }

  const handleDenyEntry = async (entryId) => {
    if (!member?.member_id) return
    await supabase.from('volunteers').update({
      approved: 'denied',
      reviewed_by: member.member_id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', entryId)
    await loadVolunteerEntries(member)
  }

  const handleCommentEntry = async (entryId) => {
    setSelectedEntryId(entryId)
    const { data } = await supabase
      .from('volunteers')
      .select('supervisor_comment')
      .eq('id', entryId)
      .single()
    setCommentText(data?.supervisor_comment || '')
    setShowCommentModal(true)
  }

  const handleSaveComment = async () => {
    if (!selectedEntryId) return
    await supabase
      .from('volunteers')
      .update({ supervisor_comment: commentText.trim() })
      .eq('id', selectedEntryId)
    setShowCommentModal(false)
    setSelectedEntryId(null)
    setCommentText('')
    await loadVolunteerEntries(member)
  }

  const handleDeleteEntry = async () => {
    if (!selectedEntryId) return
    const { error } = await supabase.from('volunteers').delete().eq('id', selectedEntryId)
    setShowDeleteModal(false)
    setSelectedEntryId(null)
    if (error) {
      console.error('Error deleting volunteer entry:', error)
      alert('Failed to delete entry: ' + error.message)
      return
    }
    await loadVolunteerEntries(member)
  }

  // Volunteer verification PDF
  const handleSendVerification = async (targetMemberId, approvedEntries) => {
    setVerificationApprovedEntries(approvedEntries || [])
    setSelectedVerificationEntryIds((approvedEntries || []).map((e) => e.id))
    setVerificationPreviewDirty(false)
    setVerificationGenerating(true)
    try {
      // Fetch full member data for the PDF (need dob, city, state, role, etc.)
      const { data: fullMember, error: memberError } = await supabase
        .from('members')
        .select('*')
        .eq('member_id', targetMemberId)
        .maybeSingle()

      if (memberError || !fullMember) {
        alert('Failed to load member data for verification letter.')
        setVerificationGenerating(false)
        return
      }

      const { generateVolunteerPDF } = await import('../lib/generateVolunteerPDF')
      const { pdfBlob, pdfBase64 } = await generateVolunteerPDF(fullMember, approvedEntries, supabase)
      const blobUrl = URL.createObjectURL(pdfBlob)

      setVerificationPdfUrl(blobUrl)
      setVerificationPdfBase64(pdfBase64)
      setVerificationMember(fullMember)
      setVerificationEntryCount(approvedEntries.length)
      setShowVerificationModal(true)
    } catch (err) {
      console.error('Error generating verification PDF:', err)
      alert('Failed to generate verification PDF: ' + err.message)
    } finally {
      setVerificationGenerating(false)
    }
  }

  const handleVerificationSelectionChange = (nextIds) => {
    setSelectedVerificationEntryIds(nextIds)
    setVerificationPreviewDirty(true)
  }

  const handleRebuildVerificationPreview = async () => {
    if (!verificationMember?.member_id) return
    const selectedEntries = (verificationApprovedEntries || []).filter((e) =>
      selectedVerificationEntryIds.includes(e.id)
    )
    if (!selectedEntries.length) {
      alert('Select at least one approved entry.')
      return
    }
    setVerificationGenerating(true)
    try {
      const { generateVolunteerPDF } = await import('../lib/generateVolunteerPDF')
      const { pdfBlob, pdfBase64 } = await generateVolunteerPDF(
        verificationMember,
        selectedEntries,
        supabase
      )
      if (verificationPdfUrl) URL.revokeObjectURL(verificationPdfUrl)
      const blobUrl = URL.createObjectURL(pdfBlob)
      setVerificationPdfUrl(blobUrl)
      setVerificationPdfBase64(pdfBase64)
      setVerificationEntryCount(selectedEntries.length)
      setVerificationPreviewDirty(false)
    } catch (err) {
      console.error('Error rebuilding verification PDF:', err)
      alert('Failed to rebuild verification PDF: ' + err.message)
    } finally {
      setVerificationGenerating(false)
    }
  }

  const handleConfirmSendVerification = async () => {
    if (!verificationMember || !verificationPdfBase64) return
    if (verificationPreviewDirty) {
      alert('Please rebuild the preview after changing entry selection.')
      return
    }
    if (!selectedVerificationEntryIds.length) {
      alert('Select at least one approved entry.')
      return
    }
    setVerificationSending(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(
        'https://qujzohvrbfsouakzocps.supabase.co/functions/v1/send-volunteer-verification',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            member_name: `${verificationMember.first_name || ''} ${verificationMember.last_name || ''}`.trim(),
            member_email: verificationMember.original_email || verificationMember.email,
            pdf_base64: verificationPdfBase64,
          }),
        }
      )
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        console.error('Verification email failed:', errData)
        alert('Failed to send verification email: ' + (errData.error || 'Unknown error'))
        return
      }
      alert('Verification letter sent successfully!')
      setShowVerificationModal(false)
      if (verificationPdfUrl) URL.revokeObjectURL(verificationPdfUrl)
      setVerificationPdfUrl(null)
      setVerificationPdfBase64(null)
      setVerificationMember(null)
    } catch (err) {
      console.error('Error sending verification email:', err)
      alert('Failed to send verification email.')
    } finally {
      setVerificationSending(false)
    }
  }

  const resolveBillAssignmentMemberName = (memberId) => {
    if (memberId == null) return 'Open — anyone can claim'
    const m =
      teamRosterMembers.find((x) => String(x.member_id) === String(memberId)) ||
      allMembersForManagement.find((x) => String(x.member_id) === String(memberId)) ||
      allMembers.find((x) => String(x.member_id) === String(memberId))
    return m ? `${m.first_name || ''} ${m.last_name || ''}`.trim() || 'Unknown' : 'Unknown'
  }

  const resolveBillAssignmentMemberNames = (memberIds) => {
    if (!memberIds?.length) return '—'
    return memberIds.map((id) => resolveBillAssignmentMemberName(id)).join(', ')
  }

  const resetAssignBillForm = () => {
    setAssignBillError('')
    setAssignBillModalHidePrefill(false)
    setAssignBillForm({
      title: '',
      goal: '',
      additionalInfo: '',
      prefillState: '',
      prefillBillName: '',
      prefillPosition: 'Support',
      prefillSourceBillId: '',
      assigneeMemberIds: [],
      dueDate: '',
      poolOpen: false,
    })
    setEditingAssignment(null)
  }

  const closeAssignBillModal = () => {
    setShowAssignBillModal(false)
    resetAssignBillForm()
  }

  const handleOpenAssignBillModal = () => {
    resetAssignBillForm()
    setAssignBillModalHidePrefill(computeAssignBillModalHidePrefill(false, null))
    setShowAssignBillModal(true)
  }

  const handleOpenEditAssignmentModal = (a) => {
    setEditingAssignment(a)
    setAssignBillError('')
    setAssignBillModalHidePrefill(computeAssignBillModalHidePrefill(true, a))
    setAssignBillForm({
      title: a.title || '',
      goal: a.goal || '',
      additionalInfo: a.additional_info || '',
      prefillState: a.prefill_state || '',
      prefillBillName: a.prefill_bill_name || '',
      prefillPosition: normalizeBillFormPosition(a.prefill_position),
      prefillSourceBillId: billIdMatchingAssignmentPrefill(allBills, a.prefill_state, a.prefill_bill_name),
      assigneeMemberIds: billAssignmentAssigneeIds(a),
      dueDate: a.due_date ? String(a.due_date).slice(0, 10) : '',
      poolOpen: a.status === 'available',
    })
    setShowAssignBillModal(true)
  }

  const handleSaveAssignBillModal = async () => {
    setAssignBillError('')
    if (!assignBillForm.title?.trim() || !assignBillForm.goal?.trim()) {
      setAssignBillError('Topic / concept and goal are required.')
      return
    }
    const ids = [...new Set((assignBillForm.assigneeMemberIds || []).filter(Boolean))]
    if (!assignBillForm.poolOpen) {
      if (ids.length === 0) {
        setAssignBillError('Select at least one assignee, or post as an open task.')
        return
      }
      for (const mid of ids) {
        const ok = assigneePickerMembers.some((m) => String(m.member_id) === String(mid))
        if (!ok) {
          setAssignBillError(
            isTeamLeadUser && !isExec
              ? 'Each assignee must be on one of your teams’ rosters (Bill permission required only for policy/bill teams).'
              : 'Each assignee must be selectable from the assignee list.'
          )
          return
        }
      }
    }
    if (!member?.member_id) return
    setAssignBillSaving(true)

    const prefillPayload = assignBillModalHidePrefill
      ? { prefill_state: null, prefill_bill_name: null, prefill_position: null }
      : {
          prefill_state:
            canonicalUSStateName(assignBillForm.prefillState) || assignBillForm.prefillState?.trim() || null,
          prefill_bill_name: assignBillForm.prefillBillName?.trim() || null,
          prefill_position: normalizeBillFormPosition(assignBillForm.prefillPosition),
        }

    if (editingAssignment) {
      const prev = editingAssignment
      const base = {
        title: assignBillForm.title.trim(),
        goal: assignBillForm.goal.trim(),
        additional_info: assignBillForm.additionalInfo?.trim() || null,
        due_date: assignBillForm.dueDate?.trim() || null,
        ...prefillPayload,
      }
      try {
        let payload
        if (assignBillForm.poolOpen) {
          payload = {
            ...base,
            status: 'available',
          }
          if (prev.status !== 'available') {
            payload.deliverable_doc_link = null
            payload.deliverable_pdf_url = null
          }
        } else {
          payload = { ...base }
          if (prev.status === 'available') {
            payload.status = 'not_started'
          }
        }
        const { error } = await supabase
          .from('bill_assignments')
          .update(payload)
          .eq('assignment_id', prev.assignment_id)
        if (error) throw new Error(error.message || 'Could not save assignment.')
        if (assignBillForm.poolOpen) {
          await replaceAssignmentAssignees(prev.assignment_id, [])
        } else {
          await replaceAssignmentAssignees(prev.assignment_id, ids)
        }
        closeAssignBillModal()
        await loadBillAssignments()
      } catch (err) {
        setAssignBillError(err.message || 'Could not save assignment.')
      } finally {
        setAssignBillSaving(false)
      }
      return
    }

    const row = assignBillForm.poolOpen
      ? {
          title: assignBillForm.title.trim(),
          goal: assignBillForm.goal.trim(),
          additional_info: assignBillForm.additionalInfo?.trim() || null,
          assigned_by_member_id: member.member_id,
          due_date: assignBillForm.dueDate?.trim() || null,
          status: 'available',
          ...prefillPayload,
        }
      : {
          title: assignBillForm.title.trim(),
          goal: assignBillForm.goal.trim(),
          additional_info: assignBillForm.additionalInfo?.trim() || null,
          assigned_by_member_id: member.member_id,
          due_date: assignBillForm.dueDate?.trim() || null,
          status: 'not_started',
          ...prefillPayload,
        }
    try {
      const { data: inserted, error } = await supabase.from('bill_assignments').insert(row).select('assignment_id').single()
      if (error) throw new Error(error.message || 'Could not create assignment.')
      if (!assignBillForm.poolOpen && inserted?.assignment_id) {
        await replaceAssignmentAssignees(inserted.assignment_id, ids)
      }
      closeAssignBillModal()
      await loadBillAssignments()
    } catch (err) {
      setAssignBillError(err.message || 'Could not create assignment.')
    } finally {
      setAssignBillSaving(false)
    }
  }

  const handleClaimBillAssignment = async (assignmentId) => {
    if (viewAsData || !member?.member_id) return
    const { error: insErr } = await supabase.from('bill_assignment_assignees').insert({
      assignment_id: assignmentId,
      member_id: member.member_id,
    })
    if (insErr) {
      alert(insErr.message || 'Could not claim task.')
      return
    }
    const { data, error } = await supabase
      .from('bill_assignments')
      .update({ status: 'not_started' })
      .eq('assignment_id', assignmentId)
      .eq('status', 'available')
      .select('assignment_id')
    if (error) {
      alert(error.message || 'Could not finalize claim.')
      await loadBillAssignments()
      return
    }
    if (!data?.length) {
      alert('This task is no longer available — someone else may have claimed it. Refresh and try again.')
      await loadBillAssignments()
      return
    }
    await loadBillAssignments()
  }

  const handleExecBillAssignmentStatus = async (assignmentId, status) => {
    const { error } = await supabase
      .from('bill_assignments')
      .update({ status })
      .eq('assignment_id', assignmentId)
    if (error) {
      alert(error.message || 'Update failed.')
      return
    }
    await loadBillAssignments()
  }

  /** Prefill and open bill upload modal; links row via billModalSourceAssignmentId on save. */
  const openPublishBillModalFromAssignment = (a) => {
    if (viewAsData) return
    const ids = billAssignmentAssigneeIds(a)
    const collaboratorNames = ids
      .map((id) => resolveBillAssignmentMemberName(id))
      .filter((n) => n && n !== 'Open — anyone can claim')

    const descParts = [a.goal, a.additional_info].filter(Boolean)
    const description = descParts.join('\n\n') || a.title || ''

    const today = new Date().toISOString().slice(0, 10)
    const position = normalizeBillFormPosition(a.prefill_position)

    const stateForLegiscan = canonicalUSStateName(a.prefill_state) || (a.prefill_state || '').trim()
    const prefillBillRaw = (a.prefill_bill_name || '').trim()
    const titleRaw = (a.title || '').trim()
    const billNumForLegiscan =
      (prefillBillRaw && isLegiscanBillNumberShape(prefillBillRaw) && prefillBillRaw) ||
      (titleRaw && isLegiscanBillNumberShape(titleRaw) ? titleRaw : '')

    const autofillToken = ++publishModalLegiscanAutofillRef.current

    setBillModalSourceAssignmentId(a.assignment_id)
    setBillError('')
    setBillSuccess('')
    setBillPdfFile(null)
    setBillForm({
      state: stateForLegiscan,
      name: ((a.prefill_bill_name || a.title) || '').trim(),
      position,
      description,
      billDate: today,
      legiscanLink: '',
      googleDocLink: (a.deliverable_doc_link || '').trim(),
      collaborators: collaboratorNames.length ? collaboratorNames : [],
    })
    setPublishLegiscanLookup(billNumForLegiscan && stateForLegiscan ? 'pending' : 'skipped')
    setShowBillModal(true)

    if (!billNumForLegiscan || !stateForLegiscan) return

    const compactBill = billNumForLegiscan.replace(/\s/g, '')
    fetchLegiscanBillBySearch(stateForLegiscan, compactBill)
      .then((res) => {
        if (autofillToken !== publishModalLegiscanAutofillRef.current) return
        if (!res.ok || !res.detail?.url) {
          setPublishLegiscanLookup('skipped')
          return
        }
        const url = String(res.detail.url).trim()
        if (!url) {
          setPublishLegiscanLookup('skipped')
          return
        }
        setBillForm((prev) => ({
          ...prev,
          legiscanLink: (prev.legiscanLink || '').trim() ? prev.legiscanLink : url,
        }))
        setPublishLegiscanLookup('filled')
      })
      .catch(() => {
        if (autofillToken !== publishModalLegiscanAutofillRef.current) return
        setPublishLegiscanLookup('skipped')
      })
  }

  /** Approve assigned work and open bill upload prefilled for execs (bill is auto-approved on save). */
  const handleExecApproveAssignment = async (a) => {
    if (viewAsData) return
    const { error } = await supabase
      .from('bill_assignments')
      .update({ status: 'approved' })
      .eq('assignment_id', a.assignment_id)
    if (error) {
      alert(error.message || 'Update failed.')
      return
    }
    await loadBillAssignments()
    openPublishBillModalFromAssignment(a)
  }

  /** Approved task but publish modal was closed without saving — reopen same prefilled form. */
  const handleReopenPublishBillFromAssignment = (a) => {
    if (viewAsData) return
    if (a.resulting_bill_id != null) {
      alert('This assignment already has a linked bill. Edit the bill from Bill Management if needed.')
      return
    }
    openPublishBillModalFromAssignment(a)
  }

  const handleSaveAssignmentDeliverable = async (assignmentId) => {
    if (viewAsData) return
    const draft = memberDeliverableInputs[assignmentId]
    if (!draft) return
    const doc = (draft.doc || '').trim()
    const pdf = (draft.pdf || '').trim()
    if (!doc?.trim()) {
      alert('Add a proposal doc link before saving.')
      return
    }
    const { error } = await supabase
      .from('bill_assignments')
      .update({
        deliverable_doc_link: doc,
        deliverable_pdf_url: pdf,
      })
      .eq('assignment_id', assignmentId)
    if (error) {
      alert(error.message || 'Could not save.')
      return
    }
    await loadBillAssignments()
  }

  const handleAssigneeAssignmentStatus = async (assignmentId, status) => {
    if (viewAsData) return
    const draft = memberDeliverableInputs[assignmentId] || {}
    const doc = draft.doc?.trim() || ''
    const pdf = draft.pdf?.trim() || ''
    if (status === 'completed' && !doc?.trim()) {
      alert('Add a proposal doc link before marking complete. (PDF link is optional.)')
      return
    }
    const payload = { status }
    if (status === 'completed') {
      payload.deliverable_doc_link = doc || null
      payload.deliverable_pdf_url = pdf || null
    }
    const { error } = await supabase.from('bill_assignments').update(payload).eq('assignment_id', assignmentId)
    if (error) {
      alert(error.message || 'Update failed.')
      return
    }
    await loadBillAssignments()
  }

  const handleConfirmDeleteBillAssignment = async () => {
    if (!assignmentToDelete?.assignment_id) return
    setDeleteAssignmentError('')
    setDeleteAssignmentSaving(true)
    const { error } = await supabase
      .from('bill_assignments')
      .delete()
      .eq('assignment_id', assignmentToDelete.assignment_id)
    setDeleteAssignmentSaving(false)
    if (error) {
      setDeleteAssignmentError(error.message || 'Could not delete assignment.')
      return
    }
    setShowDeleteAssignmentModal(false)
    setAssignmentToDelete(null)
    await loadBillAssignments()
  }

  const closeBillUploadModal = () => {
    setShowBillModal(false)
    setBillModalSourceAssignmentId(null)
    setPublishLegiscanLookup('idle')
  }

  // Bill upload management
  const handleAddBill = () => {
    setBillModalSourceAssignmentId(null)
    setPublishLegiscanLookup('idle')
    setBillForm({
      state: '',
      name: '',
      position: 'Support',
      description: '',
      billDate: '',
      legiscanLink: '',
      googleDocLink: '',
      collaborators: []
    })
    setBillPdfFile(null)
    setBillError('')
    setBillSuccess('')
    setShowBillModal(true)
  }

  const handleBillCollaboratorToggle = (memberId) => {
    const member = allMembers.find(m => m.member_id === memberId)
    if (!member) return

    const fullName = `${member.first_name} ${member.last_name}`
    const current = billForm.collaborators || []
    
    if (current.includes(fullName)) {
      setBillForm({
        ...billForm,
        collaborators: current.filter(name => name !== fullName)
      })
    } else {
      setBillForm({
        ...billForm,
        collaborators: [...current, fullName]
      })
    }
  }

  const handleSaveBill = async () => {
    const { state, name, position, description, billDate, legiscanLink, googleDocLink, collaborators } = billForm
    setBillError('')
    setBillSuccess('')

    // Validation
    if (!state || !name || !description || !billDate) {
      setBillError('State, name, description, and bill date are required.')
      return
    }
    const hasPdf = !!billPdfFile
    const hasDocLink = !!(googleDocLink && googleDocLink.trim())
    if (!hasDocLink) {
      setBillError('Please provide a link to the proposal document (e.g. Google Doc).')
      return
    }
    if (!hasPdf) {
      setBillError('Please upload a proposal PDF.')
      return
    }
    if (!collaborators || collaborators.length === 0) {
      setBillError('Please select at least one collaborator.')
      return
    }

    const stateStored = canonicalUSStateName(state) || state.trim()

    try {
      // 1. Upload PDF if provided
      let proposalPdfUrl = null
      if (billPdfFile) {
        const built = buildCanonicalProposalPdf(stateStored, name.trim())
        if (!built) {
          setBillError('Invalid state/name for PDF path.')
          return
        }
        const { error: uploadError } = await supabase.storage
          .from('proposals')
          .upload(built.storagePath, billPdfFile, {
            cacheControl: '3600',
            upsert: true
          })

        if (uploadError) {
          console.error('PDF upload error:', uploadError)
          setBillError('Failed to upload PDF. ' + uploadError.message)
          return
        }
        proposalPdfUrl = built.publicUrl
      }

      // 2. Determine bill status based on permissions
      // Only execs (all 4 permissions: volunteer, applications, bills, registration) can approve directly
      // Others with bills=true can only submit for review
      const isExec = hasPermission('volunteer') && hasPermission('applications') && hasPermission('bills') && hasPermission('registration')
      const billStatus = isExec ? 'approved' : 'under_review'

      // 3. Insert bill to database
      const { data: billData, error: insertError } = await supabase
        .from('bills')
        .insert([{
          state: stateStored,
          name: name.trim(),
          position: position,
          description: description.trim(),
          bill_date: billDate,
          legiscan_link: legiscanLink.trim() || null,
          google_doc_link: googleDocLink.trim() || null,
          bill_collaborators: collaborators.length > 0 ? collaborators : null,
          status: billStatus,
          submitted_by: billStatus === 'under_review' ? member.member_id : null,
          submitted_at: new Date().toISOString(),
          proposal_pdf_url: proposalPdfUrl,
        }])
        .select()
        .single()

      if (insertError) {
        console.error('Bill insert error:', insertError)
        setBillError('Failed to save bill. ' + insertError.message)
        return
      }

      const linkAssignmentId = billModalSourceAssignmentId
      if (linkAssignmentId && billData?.bill_id) {
        const { error: linkErr } = await supabase
          .from('bill_assignments')
          .update({ resulting_bill_id: billData.bill_id })
          .eq('assignment_id', linkAssignmentId)
        if (linkErr) {
          console.error('Could not link assignment to bill:', linkErr)
        }
        setBillModalSourceAssignmentId(null)
        await loadBillAssignments()
      }

      if (billStatus === 'approved') {
        setBillSuccess(`Bill "${stateStored} ${name}" uploaded and approved successfully!`)
      } else {
        setBillSuccess(`Bill "${stateStored} ${name}" submitted for review. It will appear on the site once approved.`)
      }
      setBillForm({
        state: '',
        name: '',
        position: 'Support',
        description: '',
        billDate: '',
        legiscanLink: '',
        googleDocLink: '',
        collaborators: []
      })
      setBillPdfFile(null)
      await loadAllBills() // Refresh bills list
      
      // Close modal after 2 seconds
      setTimeout(() => {
        closeBillUploadModal()
        setBillSuccess('')
      }, 2000)
    } catch (err) {
      console.error('Error saving bill:', err)
      setBillError(err.message || 'Failed to save bill.')
    }
  }

  // Bill edit/delete handlers for dashboard
  const handleSaveEditBill = async () => {
    const { state, name, position, description, billDate, legiscanLink, googleDocLink, hidden, collaborators } = editBillForm
    setBillError('')
    setBillSuccess('')

    if (!state || !name || !description || !billDate) {
      setBillError('State, name, description, and bill date are required.')
      return
    }
    const hasNewPdf = !!editBillPdfFile
    const hadPdf = !!(
      selectedBillForEdit &&
      (selectedBillForEdit.pdfExists || selectedBillForEdit.proposal_pdf_url)
    )
    const hasDocLink = !!(googleDocLink && googleDocLink.trim())
    if (!hasDocLink) {
      setBillError('Please provide a link to the proposal document (e.g. Google Doc).')
      return
    }
    if (!hasNewPdf && !hadPdf) {
      setBillError('Please upload a proposal PDF (or ensure one is already stored for this bill).')
      return
    }
    if (!collaborators || collaborators.length === 0) {
      setBillError('Please select at least one collaborator.')
      return
    }

    const stateStoredEdit = canonicalUSStateName(state) || state.trim()

    try {
      // 1. Upload new PDF if provided
      let proposalPdfUrl =
        selectedBillForEdit.proposal_pdf_url || selectedBillForEdit.pdfUrl || null
      if (editBillPdfFile) {
        const built = buildCanonicalProposalPdf(stateStoredEdit, name.trim())
        if (!built) {
          setBillError('Invalid state/name for PDF path.')
          return
        }
        const { error: uploadError } = await supabase.storage
          .from('proposals')
          .upload(built.storagePath, editBillPdfFile, {
            cacheControl: '3600',
            upsert: true
          })

        if (uploadError) {
          setBillError('Failed to upload PDF. ' + uploadError.message)
          return
        }
        proposalPdfUrl = built.publicUrl
      }

      // 2. Update bill in database
      console.log('Attempting to update bill:', selectedBillForEdit.bill_id)
      console.log('Update data:', {
        state: stateStoredEdit,
        name: name.trim(),
        position: position,
        description: description.trim(),
        bill_date: billDate,
        legiscan_link: legiscanLink.trim() || null,
        bill_collaborators: collaborators.length > 0 ? collaborators : null
      })
      
      const { data, error: updateError } = await supabase
        .from('bills')
        .update({
          state: stateStoredEdit,
          name: name.trim(),
          position: position,
          description: description.trim(),
          bill_date: billDate,
          legiscan_link: legiscanLink.trim() || null,
          google_doc_link: googleDocLink.trim() || null,
          hidden: !!hidden,
          bill_collaborators: collaborators.length > 0 ? collaborators : null,
          ...(proposalPdfUrl ? { proposal_pdf_url: proposalPdfUrl } : {}),
        })
        .eq('bill_id', selectedBillForEdit.bill_id)
        .select()

      if (updateError) {
        console.error('Update error:', updateError)
        setBillError('Failed to update bill. ' + updateError.message)
        return
      }

      console.log('Bill updated successfully:', data)

      setBillSuccess(`Bill "${stateStoredEdit} ${name}" updated successfully!`)
      await loadAllBills()
      
      // If this was a review edit, approve it as modified
      if (selectedBillForEdit?.isReviewEdit) {
        await handleApproveBill(selectedBillForEdit, true)
      }
      
      setTimeout(() => {
        setShowEditBillModal(false)
        setBillSuccess('')
        setSelectedBillForEdit(null)
      }, 1500)
    } catch (err) {
      setBillError(err.message || 'Failed to update bill.')
    }
  }

  const handleConfirmDeleteBill = async () => {
    if (!selectedBillForDelete) {
      console.error('No bill selected for deletion')
      return
    }

    console.log('Attempting to delete bill:', selectedBillForDelete.bill_id, selectedBillForDelete.name)
    setBillError('') // Clear any previous errors

    try {
      // Try to delete PDF in both formats (sanitized and original with spaces)
      const sanitizedName = selectedBillForDelete.name.replace(/[^a-zA-Z0-9]/g, '_')
      const sanitizedState = selectedBillForDelete.state.replace(/[^a-zA-Z0-9]/g, '_')
      const sanitizedPath = `${sanitizedState}/${sanitizedName}.pdf`
      
      // Original format with spaces
      const originalPath = `${selectedBillForDelete.state}/${selectedBillForDelete.name}.pdf`
      
      console.log('Attempting to delete PDFs:', { sanitizedPath, originalPath })
      
      // Try to delete both (one will fail if it doesn't exist, but that's okay)
      const pathsToDelete = [sanitizedPath, originalPath]
      const { error: storageError } = await supabase.storage
        .from('proposals')
        .remove(pathsToDelete)
      
      // Don't fail if PDF doesn't exist - just log it
      if (storageError) {
        console.warn('PDF deletion warning (may not exist):', storageError)
      } else {
        console.log('PDF deletion successful (or files did not exist)')
      }

      // Delete bill from database
      console.log('Attempting to delete bill from database:', selectedBillForDelete.bill_id)
      const { data, error } = await supabase
        .from('bills')
        .delete()
        .eq('bill_id', selectedBillForDelete.bill_id)
        .select()

      if (error) {
        console.error('Database delete error:', error)
        throw error
      }

      console.log('Bill deleted successfully:', data)

      setShowDeleteBillModal(false)
      setSelectedBillForDelete(null)
      setBillError('')
      await loadAllBills()
    } catch (err) {
      console.error('Delete error:', err)
      const errorMessage = err.message || 'Unknown error occurred'
      setBillError(`Failed to delete bill: ${errorMessage}`)
      // Keep modal open so user can see the error
    }
  }

  // Bill review handlers (for execs and policy leads)
  const handleApproveBill = async (bill, modified = false, hidden = false) => {
    try {
      const updatePayload = {
        status: modified ? 'modified' : 'approved',
        reviewed_by: member.member_id,
        reviewed_at: new Date().toISOString()
      }
      if (!modified) updatePayload.hidden = hidden

      const { error } = await supabase
        .from('bills')
        .update(updatePayload)
        .eq('bill_id', bill.bill_id)

      if (error) throw error

      await loadAllBills()
    } catch (err) {
      console.error('Error approving bill:', err)
      alert('Failed to approve bill: ' + err.message)
    }
  }

  const handleRejectBill = async (bill, reviewNotes = '') => {
    try {
      const { error } = await supabase
        .from('bills')
        .update({
          status: 'rejected',
          reviewed_by: member.member_id,
          reviewed_at: new Date().toISOString(),
          review_notes: reviewNotes || null
        })
        .eq('bill_id', bill.bill_id)

      if (error) throw error

      await loadAllBills()
    } catch (err) {
      console.error('Error rejecting bill:', err)
      alert('Failed to reject bill: ' + err.message)
    }
  }

  const handleModifyAndApproveBill = async (bill) => {
    // Open edit modal, then approve after save
    setSelectedBillForEdit(bill)
    setEditBillForm({
      state: bill.state || '',
      name: bill.name || '',
      position: bill.position || 'Support',
      description: bill.description || '',
      billDate: bill.bill_date ? new Date(bill.bill_date).toISOString().split('T')[0] : '',
      legiscanLink: bill.legiscan_link || '',
      googleDocLink: bill.google_doc_link || '',
      hidden: !!(bill.hidden),
      collaborators: bill.bill_collaborators || []
    })
    setEditBillPdfFile(null)
    setBillError('')
    setBillSuccess('')
    setShowEditBillModal(true)
    // Mark that this is a review edit
    setSelectedBillForEdit({ ...bill, isReviewEdit: true })
  }

  // Helper function to generate SPAN email from first and last name
  const generateSpanEmail = (firstName, lastName) => {
    if (!firstName || !lastName) return ''
    const first = firstName.toLowerCase().trim()
    const last = lastName.toLowerCase().trim()
    return `${first}.${last}@spanationwide.org`
  }

  // Member management handlers
  const handleAddMember = () => {
    setEditingMemberId(null)
    emailManuallyEdited.current = false
    setMemberForm({
      firstName: '',
      lastName: '',
      middleName: '',
      preferredName: '',
      email: '',
      originalEmail: '',
      role: '',
      active: true,
      startDate: '',
      dob: '',
      grade: '',
      gradeOther: '',
      schoolName: '',
      city: '',
      state: '',
      phone: '',
      linkedin: '',
      instagram: '',
      notes: '',
      bio: '',
      volunteer: false,
      applications: false,
      bills: false,
      registration: false,
      blog: false
    })
    setMemberError('')
    setMemberSuccess('')
    setShowMemberModal(true)
  }

  const handleImportFromApplication = (application) => {
    // Parse full_name into first and last name
    const nameParts = (application.full_name || '').trim().split(/\s+/)
    const firstName = nameParts[0] || ''
    const lastName = nameParts.slice(1).join(' ') || ''
    
    // Generate SPAN email
    const spanEmail = generateSpanEmail(firstName, lastName)
    
    // Prefill form with application data
    const baseNotes = (application.additional_info || '').trim()
    const countryNote =
      application.country && String(application.country).trim()
        ? `Country (from application): ${String(application.country).trim()}`
        : ''
    const mergedNotes = [baseNotes, countryNote].filter(Boolean).join('\n\n')
    const { grade, gradeOther } = splitMemberGradeForForm(application.grade)

    setMemberForm({
      firstName: firstName,
      lastName: lastName,
      middleName: '',
      preferredName: '',
      email: spanEmail,
      originalEmail: application.email || '',
      role: '', // Leave role empty for admin to fill
      active: true,
      startDate: '',
      dob: '',
      grade,
      gradeOther,
      schoolName: application.school || '',
      city: '',
      state: application.state || '',
      phone: application.phone_number || '',
      linkedin: application.linkedin_url || '',
      instagram: application.instagram_url || '',
      notes: mergedNotes,
      bio: '',
      volunteer: false,
      applications: false,
      bills: false,
      registration: false,
      blog: false
    })
    
    setShowImportApplicationModal(false)
    setMemberError('')
    setMemberSuccess('')
  }

  // Auto-update SPAN email when first/last name changes
  useEffect(() => {
    if (!editingMemberId && showMemberModal && memberForm.firstName && memberForm.lastName && !emailManuallyEdited.current) {
      const generatedEmail = generateSpanEmail(memberForm.firstName, memberForm.lastName)
      if (generatedEmail) {
        setMemberForm(prev => ({ ...prev, email: generatedEmail }))
      }
    }
  }, [memberForm.firstName, memberForm.lastName, editingMemberId, showMemberModal])

  // Reset manual edit flag when modal opens/closes
  useEffect(() => {
    if (showMemberModal && !editingMemberId) {
      emailManuallyEdited.current = false
    }
  }, [showMemberModal, editingMemberId])

  // Rejection modal: load Resend email preview when “send email” is checked (matches invitation flow).
  useEffect(() => {
    if (!showRejectConfirmModal || !selectedApplication) {
      return
    }
    const email = (selectedApplication.email || '').trim()
    if (!sendRejectionEmail || !email) {
      setRejectionEmailPreview(null)
      setRejectionEmailPreviewLoading(false)
      return
    }
    let cancelled = false
    setRejectionEmailPreviewLoading(true)
    setRejectionEmailPreview(null)

    const timeoutId = window.setTimeout(() => {
      ;(async () => {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession()
          if (!session?.access_token) {
            if (!cancelled) setRejectionEmailPreviewLoading(false)
            return
          }
          const base = import.meta.env.VITE_SUPABASE_URL
          const resp = await fetch(`${base}/functions/v1/send-rejection-email`, {
            method: 'POST',
            headers: supabaseInvokeHeaders(session.access_token),
            body: JSON.stringify({
              dry_run: true,
              applicant_name: selectedApplication.full_name,
              applicant_email: email,
              rejection_reason: rejectionEmailReason.trim() || null,
            }),
          })
          const data = await resp.json().catch(() => ({}))
          if (!resp.ok) {
            throw new Error(
              typeof data.error === 'string' ? data.error : data.details || 'Could not load email preview'
            )
          }
          if (typeof data.html !== 'string' || !String(data.html).trim()) {
            throw new Error(
              'Preview is empty: the deployed send-rejection-email function may be an older version (ignores dry_run). Redeploy it from the repo, then try again.'
            )
          }
          if (!cancelled) setRejectionEmailPreview(data)
        } catch (err) {
          console.error('Rejection email preview error:', err)
          if (!cancelled) {
            alert(
              err.message ||
                'Could not load rejection email preview. Uncheck “send email” to reject without notifying, or try again.'
            )
            setRejectionEmailPreview(null)
          }
        } finally {
          if (!cancelled) setRejectionEmailPreviewLoading(false)
        }
      })()
    }, 400)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [
    showRejectConfirmModal,
    sendRejectionEmail,
    selectedApplication?.application_id,
    selectedApplication?.email,
    selectedApplication?.full_name,
    rejectionEmailReason,
  ])

  const handleEditMember = (memberToEdit) => {
    setEditingMemberId(memberToEdit.member_id)
    const { grade, gradeOther } = splitMemberGradeForForm(memberToEdit.grade)
    setMemberForm({
      firstName: memberToEdit.first_name || '',
      lastName: memberToEdit.last_name || '',
      middleName: memberToEdit.middle_name || '',
      preferredName: memberToEdit.preferred_name || '',
      email: memberToEdit.email || '',
      originalEmail: memberToEdit.original_email || '',
      role: memberToEdit.role || '',
      active: memberToEdit.active !== false,
      startDate: memberToEdit.start_date || '',
      dob: memberToEdit.dob || '',
      grade,
      gradeOther,
      schoolName: memberToEdit.school_name || '',
      city: memberToEdit.city || '',
      state: memberToEdit.state || '',
      phone: memberToEdit.phone ? formatPhone(memberToEdit.phone.toString()) : '',
      linkedin: memberToEdit.linkedin || '',
      instagram: memberToEdit.instagram || '',
      notes: memberToEdit.notes || '',
      bio: memberToEdit.bio || '',
      volunteer: memberToEdit.volunteer === true || memberToEdit.volunteer === 'true',
      applications: memberToEdit.applications === true || memberToEdit.applications === 'true',
      bills: memberToEdit.bills === true || memberToEdit.bills === 'true',
      registration: memberToEdit.registration === true || memberToEdit.registration === 'true',
      blog: memberToEdit.blog === true || memberToEdit.blog === 'true'
    })
    setMemberError('')
    setMemberSuccess('')
    setShowMemberModal(true)
  }

  const handleSaveMember = async () => {
    const {
      firstName,
      lastName,
      middleName,
      preferredName,
      email,
      originalEmail,
      role,
      active,
      startDate,
      dob,
      grade,
      gradeOther,
      schoolName,
      city,
      state,
      phone,
      linkedin,
      instagram,
      notes,
      bio,
      volunteer,
      applications,
      bills,
      registration,
      blog,
    } = memberForm
    setMemberError('')
    setMemberSuccess('')

    // Validation
    if (!firstName || !lastName || !email || !originalEmail || !role) {
      setMemberError('First name, last name, email, original email, and role are required.')
      return
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      setMemberError('Please enter a valid SPAN email address.')
      return
    }
    if (!emailRegex.test(originalEmail)) {
      setMemberError('Please enter a valid personal email address.')
      return
    }

    const resolvedGrade = resolveMemberGrade(grade, gradeOther)
    if (grade === 'Other' && !resolvedGrade) {
      setMemberError('Please specify the member grade.')
      return
    }

    try {
      if (editingMemberId) {
        // Update existing member
        const { data: memberDataResult, error: updateError } = await supabase.rpc('update_member', {
          p_member_id: editingMemberId,
          p_first_name: firstName.trim(),
          p_last_name: lastName.trim(),
          p_middle_name: middleName.trim(),
          p_preferred_name: preferredName.trim(),
          p_email: email.trim().toLowerCase(),
          p_original_email: originalEmail.trim().toLowerCase(),
          p_role: role.trim(),
          p_active: active,
          p_start_date: startDate || null,
          p_dob: dob || null,
          p_grade: resolvedGrade,
          p_school_name: schoolName.trim() || null,
          p_city: city.trim() || null,
          p_state: state.trim() || null,
          p_phone: phone ? phone.replace(/\D/g, '') : null,
          p_linkedin: linkedin.trim() || null,
          p_instagram: instagram.trim() || null,
          p_notes: notes.trim() || null,
          p_bio: bio.trim() || null,
          p_volunteer: volunteer,
          p_applications: applications,
          p_bills: bills,
          p_registration: registration,
          p_blog: blog,
        })

        if (updateError) {
          console.error('Member update error:', updateError)
          setMemberError('Failed to update member. ' + updateError.message)
          return
        }

        setMemberSuccess(`Member "${firstName} ${lastName}" updated successfully!`)
      } else {
        // Create new member
        const { data: memberDataResult, error: insertError } = await supabase.rpc('create_member', {
          p_first_name: firstName.trim(),
          p_last_name: lastName.trim(),
          p_middle_name: middleName.trim(),
          p_preferred_name: preferredName.trim(),
          p_email: email.trim().toLowerCase(),
          p_original_email: originalEmail.trim().toLowerCase(),
          p_role: role.trim(),
          p_active: active,
          p_start_date: startDate || null,
          p_dob: dob || null,
          p_grade: resolvedGrade,
          p_school_name: schoolName.trim() || null,
          p_city: city.trim() || null,
          p_state: state.trim() || null,
          p_phone: phone ? phone.replace(/\D/g, '') : null,
          p_linkedin: linkedin.trim() || null,
          p_instagram: instagram.trim() || null,
          p_notes: notes.trim() || null,
          p_bio: bio.trim() || null,
          p_volunteer: volunteer,
          p_applications: applications,
          p_bills: bills,
          p_registration: registration,
          p_blog: blog,
        })

        if (insertError) {
          console.error('Member insert error:', insertError)
          setMemberError('Failed to save member. ' + insertError.message)
          return
        }

        setMemberSuccess(`Member "${firstName} ${lastName}" added successfully! They will receive an email invitation to set up their account.`)
      }

      const savedEditingId = editingMemberId

      // Reset form
      setMemberForm({
        firstName: '',
        lastName: '',
        middleName: '',
        preferredName: '',
        email: '',
        originalEmail: '',
        role: '',
        active: true,
        startDate: '',
        dob: '',
        schoolName: '',
        city: '',
        state: '',
        phone: '',
        linkedin: '',
        instagram: '',
        notes: '',
        bio: '',
        volunteer: false,
        applications: false,
        bills: false,
        registration: false,
        blog: false
      })
      setEditingMemberId(null)
      
      // Refresh members lists
      await loadAllMembers()
      if (hasPermission('registration')) {
        await loadAllMembersForManagement()
      }
      if (savedEditingId && member?.member_id === savedEditingId) {
        await loadMemberData(true)
      }
      
      // Close modal after 3 seconds
      setTimeout(() => {
        setShowMemberModal(false)
        setMemberSuccess('')
      }, 3000)
    } catch (err) {
      console.error('Error saving member:', err)
      setMemberError(err.message || 'Failed to save member.')
    }
  }

  // Application management handlers
  const handleViewApplication = (application) => {
    setSelectedApplication(application)
    setApplicationNotes(application.notes || '')
    setApplicationNumericGrade(
      application.numeric_grade != null && application.numeric_grade !== ''
        ? String(application.numeric_grade)
        : ''
    )
    setShowApplicationModal(true)
  }

  const handleSaveApplicationNumericGrade = async () => {
    if (!selectedApplication) return
    const t = applicationNumericGrade.trim()
    let value = null
    if (t !== '') {
      const n = parseFloat(t)
      if (!Number.isFinite(n)) {
        alert('Please enter a valid number (e.g. 1, 2, 3, or 1.5).')
        return
      }
      value = n
    }
    try {
      const { error } = await supabase
        .from('applications')
        .update({ numeric_grade: value })
        .eq('application_id', selectedApplication.application_id)
      if (error) {
        console.error('Error saving review score:', error)
        alert('Failed to save review score: ' + error.message)
        return
      }
      await loadApplications()
      setSelectedApplication((prev) => (prev ? { ...prev, numeric_grade: value } : null))
    } catch (err) {
      console.error('Error saving review score:', err)
      alert('Failed to save review score.')
    }
  }

  const closeApplicationModal = () => {
    setShowApplicationModal(false)
    setSelectedApplication(null)
    setApplicationNotes('')
    setApplicationNumericGrade('')
    setShowInviteEmailModal(false)
    setInviteEmailPreview(null)
    setInviteEmailPreviewLoading(false)
    setShowOnboardScheduleEmailModal(false)
    setOnboardScheduleEmailPreview(null)
    setOnboardScheduleEmailPreviewLoading(false)
    setAiCheckResult(null)
    setAiCheckLoading(false)
  }

  const handleCheckAiText = async (text) => {
    if (!text || text.trim().length === 0) return
    setAiCheckResult(null)
    setAiCheckLoading(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        alert('You must be signed in.')
        return
      }
      const data = await runAiTextCheck(text.trim(), session.access_token)
      setAiCheckResult(data)
    } catch (err) {
      console.error('AI text check error:', err)
      alert(err.message || 'AI text detection failed.')
    } finally {
      setAiCheckLoading(false)
    }
  }

  const handleCheckBillProposalAi = async (bill) => {
    if (!bill?.bill_id) return
    const id = bill.bill_id
    setBillProposalAiCheckLoadingId(id)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        alert('You must be signed in.')
        return
      }
      const data = await checkAiFromBill(bill, session.access_token, getBillPdfUrl)
      setBillProposalAiChecks((prev) => ({ ...prev, [id]: data }))
    } catch (err) {
      console.error('Bill proposal AI check error:', err)
      alert(err.message || 'AI text detection failed.')
    } finally {
      setBillProposalAiCheckLoadingId(null)
    }
  }

  const handleCheckAssignmentProposalAi = async (assignment) => {
    if (!assignment?.assignment_id) return
    const id = assignment.assignment_id
    setAssignmentAiCheckLoadingId(id)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        alert('You must be signed in.')
        return
      }
      const data = await checkAiFromAssignment(assignment, session.access_token)
      setAssignmentAiChecks((prev) => ({ ...prev, [id]: data }))
    } catch (err) {
      console.error('Assignment proposal AI check error:', err)
      alert(err.message || 'AI text detection failed.')
    } finally {
      setAssignmentAiCheckLoadingId(null)
    }
  }

  const openInviteEmailPreviewModal = async () => {
    if (!selectedApplication) return
    const email = (selectedApplication.email || '').trim()
    if (!email) {
      alert('This application has no email address. Add an email before sending an invitation.')
      return
    }
    setShowInviteEmailModal(true)
    setInviteEmailPreview(null)
    setInviteEmailPreviewLoading(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        alert('You must be signed in.')
        setShowInviteEmailModal(false)
        return
      }
      const base = import.meta.env.VITE_SUPABASE_URL
      const resp = await fetch(`${base}/functions/v1/send-invitation-email`, {
        method: 'POST',
        headers: supabaseInvokeHeaders(session.access_token),
        body: JSON.stringify({
          dry_run: true,
          applicant_name: selectedApplication.full_name,
          applicant_email: email,
        }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : data.details || 'Could not load email preview'
        )
      }
      setInviteEmailPreview(data)
    } catch (err) {
      console.error('Invitation preview error:', err)
      alert(err.message || 'Could not load email preview.')
      setShowInviteEmailModal(false)
    } finally {
      setInviteEmailPreviewLoading(false)
    }
  }

  const handleSendInvitationEmailAndMarkInvited = async () => {
    if (!selectedApplication) return
    const email = (selectedApplication.email || '').trim()
    if (!email) {
      alert('This application has no email address.')
      return
    }
    const from = selectedApplication.status
    if (!isAllowedApplicationStatusTransition(from, 'invited')) {
      alert('This application can no longer be moved to Invited from its current stage.')
      setShowInviteEmailModal(false)
      return
    }

    setInviteEmailSending(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        alert('You must be signed in.')
        return
      }
      const base = import.meta.env.VITE_SUPABASE_URL
      const resp = await fetch(`${base}/functions/v1/send-invitation-email`, {
        method: 'POST',
        headers: supabaseInvokeHeaders(session.access_token),
        body: JSON.stringify({
          dry_run: false,
          applicant_name: selectedApplication.full_name,
          applicant_email: email,
        }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : data.details || 'Failed to send invitation email'
        )
      }

      const { error } = await supabase
        .from('applications')
        .update({
          status: 'invited',
          reviewed_by: member.member_id,
          reviewed_at: new Date().toISOString(),
          notes: applicationNotes.trim() || null,
        })
        .eq('application_id', selectedApplication.application_id)

      if (error) {
        console.error('Error marking invited after email:', error)
        alert(
          'The invitation email was sent, but updating the application status failed: ' +
            error.message +
            '\n\nPlease set the status to Invited manually if needed.'
        )
        setShowInviteEmailModal(false)
        setInviteEmailPreview(null)
        await loadApplications()
        return
      }

      await loadApplications()
      setShowInviteEmailModal(false)
      setInviteEmailPreview(null)
      closeApplicationModal()
    } catch (err) {
      console.error('Send invitation error:', err)
      alert(err.message || 'Failed to send invitation email. The application was not marked as invited.')
    } finally {
      setInviteEmailSending(false)
    }
  }

  const closeFollowUpModal = () => {
    setShowFollowUpModal(false)
    setFollowUpApplication(null)
    setFollowUpPreview(null)
    setFollowUpPreviewLoading(false)
  }

  const openFollowUpPreviewModal = async (app) => {
    if (!app) return
    const email = (app.email || '').trim()
    if (!email) {
      alert('This application has no email address. Add an email before sending a follow-up.')
      return
    }
    setFollowUpApplication(app)
    setShowFollowUpModal(true)
    setFollowUpPreview(null)
    setFollowUpPreviewLoading(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        alert('You must be signed in.')
        closeFollowUpModal()
        return
      }
      const base = import.meta.env.VITE_SUPABASE_URL
      const resp = await fetch(`${base}/functions/v1/send-invitation-email`, {
        method: 'POST',
        headers: supabaseInvokeHeaders(session.access_token),
        body: JSON.stringify({
          dry_run: true,
          follow_up: true,
          applicant_name: app.full_name,
          applicant_email: email,
        }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : data.details || 'Could not load follow-up preview'
        )
      }
      setFollowUpPreview(data)
    } catch (err) {
      console.error('Follow-up preview error:', err)
      alert(err.message || 'Could not load follow-up preview.')
      closeFollowUpModal()
    } finally {
      setFollowUpPreviewLoading(false)
    }
  }

  const handleSendFollowUpEmail = async () => {
    const app = followUpApplication
    if (!app) return
    const email = (app.email || '').trim()
    if (!email) {
      alert('This application has no email address.')
      return
    }
    if (app.status !== 'invited') {
      alert('Follow-ups can only be sent for applications in the Invited stage.')
      closeFollowUpModal()
      return
    }

    setFollowUpSending(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        alert('You must be signed in.')
        return
      }
      const base = import.meta.env.VITE_SUPABASE_URL
      const resp = await fetch(`${base}/functions/v1/send-invitation-email`, {
        method: 'POST',
        headers: supabaseInvokeHeaders(session.access_token),
        body: JSON.stringify({
          dry_run: false,
          follow_up: true,
          applicant_name: app.full_name,
          applicant_email: email,
        }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : data.details || 'Failed to send follow-up email'
        )
      }

      const { error } = await supabase
        .from('applications')
        .update({
          follow_up_count: (app.follow_up_count || 0) + 1,
          last_follow_up_at: new Date().toISOString(),
        })
        .eq('application_id', app.application_id)

      if (error) {
        console.error('Error updating follow-up count:', error)
        alert(
          'The follow-up email was sent, but updating the follow-up count failed: ' +
            error.message
        )
      }

      await loadApplications()
      closeFollowUpModal()
    } catch (err) {
      console.error('Send follow-up error:', err)
      alert(err.message || 'Failed to send follow-up email.')
    } finally {
      setFollowUpSending(false)
    }
  }

  const loadOnboardScheduleEmailPreview = async (when2meetUrlStr, deadlineNoteStr) => {
    if (!selectedApplication) return
    const email = (selectedApplication.email || '').trim()
    if (!email) {
      alert('This application has no email address. Add an email before sending the onboarding scheduling message.')
      return
    }
    setOnboardScheduleEmailPreviewLoading(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        alert('You must be signed in.')
        setShowOnboardScheduleEmailModal(false)
        return
      }
      const base = import.meta.env.VITE_SUPABASE_URL
      const resp = await fetch(`${base}/functions/v1/send-onboarding-schedule-email`, {
        method: 'POST',
        headers: supabaseInvokeHeaders(session.access_token),
        body: JSON.stringify({
          dry_run: true,
          applicant_name: selectedApplication.full_name,
          applicant_email: email,
          ...(String(when2meetUrlStr || '').trim()
            ? { when2meet_url: String(when2meetUrlStr).trim() }
            : {}),
          ...(String(deadlineNoteStr || '').trim()
            ? { deadline_note: String(deadlineNoteStr).trim() }
            : {}),
        }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : data.details || 'Could not load email preview'
        )
      }
      setOnboardScheduleEmailPreview(data)
    } catch (err) {
      console.error('Onboarding schedule email preview error:', err)
      alert(err.message || 'Could not load email preview.')
      setShowOnboardScheduleEmailModal(false)
    } finally {
      setOnboardScheduleEmailPreviewLoading(false)
    }
  }

  const openOnboardScheduleEmailPreviewModal = async () => {
    if (!selectedApplication) return
    const email = (selectedApplication.email || '').trim()
    if (!email) {
      alert('This application has no email address. Add an email before sending the onboarding scheduling message.')
      return
    }
    setOnboardScheduleWhen2meetUrl('')
    setOnboardScheduleDeadlineNote('')
    setShowOnboardScheduleEmailModal(true)
    setOnboardScheduleEmailPreview(null)
    await loadOnboardScheduleEmailPreview('', '')
  }

  const handleSendOnboardingScheduleEmailAndMarkOnboard = async () => {
    if (!selectedApplication) return
    const email = (selectedApplication.email || '').trim()
    if (!email) {
      alert('This application has no email address.')
      return
    }
    const from = selectedApplication.status
    if (!isAllowedApplicationStatusTransition(from, 'onboard')) {
      alert('This application can no longer be moved to Onboard from its current stage.')
      setShowOnboardScheduleEmailModal(false)
      return
    }

    setOnboardScheduleEmailSending(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        alert('You must be signed in.')
        return
      }
      const base = import.meta.env.VITE_SUPABASE_URL
      const resp = await fetch(`${base}/functions/v1/send-onboarding-schedule-email`, {
        method: 'POST',
        headers: supabaseInvokeHeaders(session.access_token),
        body: JSON.stringify({
          dry_run: false,
          applicant_name: selectedApplication.full_name,
          applicant_email: email,
          ...(onboardScheduleWhen2meetUrl.trim()
            ? { when2meet_url: onboardScheduleWhen2meetUrl.trim() }
            : {}),
          ...(onboardScheduleDeadlineNote.trim()
            ? { deadline_note: onboardScheduleDeadlineNote.trim() }
            : {}),
        }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : data.details || 'Failed to send onboarding scheduling email'
        )
      }

      const nowIso = new Date().toISOString()
      const { error } = await supabase
        .from('applications')
        .update({
          status: 'onboard',
          reviewed_by: member.member_id,
          reviewed_at: nowIso,
          notes: applicationNotes.trim() || null,
        })
        .eq('application_id', selectedApplication.application_id)

      if (error) {
        console.error('Error marking onboard after email:', error)
        alert(
          'The email was sent, but updating the application status failed: ' +
            error.message +
            '\n\nPlease set the status to Onboard manually if needed.'
        )
        setShowOnboardScheduleEmailModal(false)
        setOnboardScheduleEmailPreview(null)
        await loadApplications()
        return
      }

      await loadApplications()
      setShowOnboardScheduleEmailModal(false)
      setOnboardScheduleEmailPreview(null)
      closeApplicationModal()
    } catch (err) {
      console.error('Send onboarding schedule email error:', err)
      alert(
        err.message ||
          'Failed to send onboarding scheduling email. The application was not marked as Onboard.'
      )
    } finally {
      setOnboardScheduleEmailSending(false)
    }
  }

  const handleUpdateApplicationStatus = async (status, options = {}) => {
    if (!selectedApplication) return

    const from = selectedApplication.status
    if (status === 'pending') {
      if (from !== 'accepted' && from !== 'rejected') {
        alert('Only accepted or rejected applications can be reset to pending.')
        return
      }
    } else if (!isAllowedApplicationStatusTransition(from, status)) {
      alert(
        'That status change is not allowed. Applications can only move forward in the pipeline (or be rejected), not back to an earlier stage.'
      )
      return
    }

    try {
      const nowIso = new Date().toISOString()
      const patch = {
        status: status,
        reviewed_by: member.member_id,
        reviewed_at: nowIso,
        notes: applicationNotes.trim() || null,
      }

      // Capture met-with timestamp when moving into met_with.
      if (status === 'met_with') {
        if (options.met_with_at) {
          patch.met_with_at = options.met_with_at
        } else {
          patch.met_with_at = nowIso
        }
      }

      const { error } = await supabase
        .from('applications')
        .update(patch)
        .eq('application_id', selectedApplication.application_id)

      if (error) {
        console.error('Error updating application:', error)
        alert('Failed to update application status: ' + error.message)
        return
      }

      await loadApplications()
      closeApplicationModal()
    } catch (err) {
      console.error('Error updating application:', err)
      alert('Failed to update application status.')
    }
  }

  const handleSetMetWithAt = async (applicationId, dateStr) => {
    if (!applicationId) return
    try {
      let metWithAt = null
      if (dateStr && String(dateStr).trim()) {
        // Store at local noon to avoid DST edge cases.
        metWithAt = new Date(`${dateStr}T12:00:00`).toISOString()
      }
      const { error } = await supabase
        .from('applications')
        .update({
          met_with_at: metWithAt,
          reviewed_by: member.member_id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('application_id', applicationId)

      if (error) {
        console.error('Error saving met_with_at:', error)
        alert('Failed to save met with date: ' + error.message)
        return
      }

      setApplications((prev) =>
        prev.map((a) => (a.application_id === applicationId ? { ...a, met_with_at: metWithAt } : a))
      )
      setSelectedApplication((prev) =>
        prev && prev.application_id === applicationId ? { ...prev, met_with_at: metWithAt } : prev
      )
    } catch (err) {
      console.error('Error saving met_with_at:', err)
      alert('Failed to save met with date.')
    }
  }

  const openMetWithDateModal = () => {
    if (!selectedApplication) return
    const existing = selectedApplication.met_with_at
      ? String(selectedApplication.met_with_at).slice(0, 10)
      : ''
    const today = new Date().toISOString().slice(0, 10)
    setMetWithDateInput(existing || today)
    setShowMetWithDateModal(true)
  }

  const confirmMetWithDate = async () => {
    if (!metWithDateInput) {
      alert('Choose a date.')
      return
    }
    // Store as an ISO timestamp at local noon to avoid DST edge cases.
    const iso = new Date(`${metWithDateInput}T12:00:00`).toISOString()
    setShowMetWithDateModal(false)
    await handleUpdateApplicationStatus('met_with', { met_with_at: iso })
  }

  const handleAcceptApplication = async () => {
    if (!selectedApplication) return

    if (!isAllowedApplicationStatusTransition(selectedApplication.status, 'accepted')) {
      alert(
        'This application cannot be accepted from its current status. Only pipeline stages (pending through onboard) can be accepted.'
      )
      return
    }

    try {
      const { error } = await supabase
        .from('applications')
        .update({
          status: 'accepted',
          reviewed_by: member.member_id,
          reviewed_at: new Date().toISOString(),
          notes: applicationNotes.trim() || null
        })
        .eq('application_id', selectedApplication.application_id)

      if (error) {
        console.error('Error accepting application:', error)
        alert('Failed to accept application: ' + error.message)
        return
      }

      // Save application data before closing the modal
      const appData = { ...selectedApplication }

      await loadApplications()
      closeApplicationModal()

      // Pre-fill the Add Member form with application data and open it
      setEditingMemberId(null)
      emailManuallyEdited.current = false
      handleImportFromApplication(appData)
      setShowMemberModal(true)
    } catch (err) {
      console.error('Error accepting application:', err)
      alert('Failed to accept application.')
    }
  }

  const handleRejectApplication = async () => {
    if (!selectedApplication) return

    if (!isAllowedApplicationStatusTransition(selectedApplication.status, 'rejected')) {
      alert('Only applications in the review pipeline (pending through onboard) can be rejected from this flow.')
      return
    }

    try {
      // Update status to rejected
      const { error } = await supabase
        .from('applications')
        .update({
          status: 'rejected',
          reviewed_by: member.member_id,
          reviewed_at: new Date().toISOString(),
          notes: applicationNotes.trim() || null
        })
        .eq('application_id', selectedApplication.application_id)

      if (error) {
        console.error('Error rejecting application:', error)
        alert('Failed to reject application: ' + error.message)
        return
      }

      // Send rejection email if opted in
      if (sendRejectionEmail && selectedApplication.email) {
        setRejectionEmailSending(true)
        try {
          const { data: { session } } = await supabase.auth.getSession()
          const base = import.meta.env.VITE_SUPABASE_URL
          const token = session?.access_token
          if (!token) {
            alert('Application was rejected, but you are not signed in; rejection email was not sent.')
          } else {
          const resp = await fetch(`${base}/functions/v1/send-rejection-email`, {
            method: 'POST',
            headers: supabaseInvokeHeaders(token),
            body: JSON.stringify({
              dry_run: false,
              applicant_name: selectedApplication.full_name,
              applicant_email: selectedApplication.email,
              rejection_reason: rejectionEmailReason.trim() || null,
            }),
          })
          if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}))
            console.error('Rejection email failed:', errData)
            alert('Application was rejected, but the rejection email failed to send. You may need to notify the applicant manually.')
          }
          }
        } catch (emailErr) {
          console.error('Error sending rejection email:', emailErr)
          alert('Application was rejected, but the rejection email failed to send. You may need to notify the applicant manually.')
        } finally {
          setRejectionEmailSending(false)
        }
      }

      setShowRejectConfirmModal(false)
      setSendRejectionEmail(true)
      setRejectionEmailPreview(null)
      setRejectionEmailPreviewLoading(false)
      setRejectionEmailReason('')
      await loadApplications()
      closeApplicationModal()
    } catch (err) {
      console.error('Error rejecting application:', err)
      alert('Failed to reject application.')
    }
  }

  const handleDeleteApplication = async () => {
    if (!selectedApplication) return

    try {
      const { error } = await supabase
        .from('applications')
        .delete()
        .eq('application_id', selectedApplication.application_id)

      if (error) {
        console.error('Error deleting application:', error)
        alert('Failed to delete application: ' + error.message)
        return
      }

      // Close both modals and refresh the list
      setShowDeleteApplicationModal(false)
      closeApplicationModal()
      await loadApplications()
    } catch (err) {
      console.error('Error deleting application:', err)
      alert('Failed to delete application.')
    }
  }

  const filteredApplications = applicationFilter === 'all' 
    ? applications 
    : applications.filter(app => app.status === applicationFilter)

  // Partner management handlers
  const handleAddPartner = () => {
    setEditingPartnerId(null)
    setPartnerForm({
      partnerName: '',
      websiteUrl: '',
      displayOrder: 999,
      active: true
    })
    setPartnerLogoFile(null)
    setPartnerError('')
    setPartnerSuccess('')
    setShowPartnerModal(true)
  }

  const handleEditPartner = (partner) => {
    setEditingPartnerId(partner.partner_id)
    setPartnerForm({
      partnerName: partner.partner_name,
      websiteUrl: partner.website_url || '',
      displayOrder: partner.display_order || 999,
      active: partner.active !== false
    })
    setPartnerLogoFile(null)
    setPartnerError('')
    setPartnerSuccess('')
    setShowPartnerModal(true)
  }

  const handleSavePartner = async () => {
    const { partnerName, websiteUrl, displayOrder, active } = partnerForm
    setPartnerError('')
    setPartnerSuccess('')

    if (!partnerName.trim()) {
      setPartnerError('Partner name is required.')
      return
    }

    try {
      let logoFilename = null

      // Upload logo if a new file was selected
      if (partnerLogoFile) {
        const fileExt = partnerLogoFile.name.split('.').pop()
        const fileName = `${Date.now()}-${partnerName.replace(/[^a-zA-Z0-9]/g, '_')}.${fileExt}`
        
        const { error: uploadError } = await supabase.storage
          .from('partners-images')
          .upload(fileName, partnerLogoFile, {
            cacheControl: '3600',
            upsert: false
          })

        if (uploadError) {
          console.error('Error uploading logo:', uploadError)
          setPartnerError('Failed to upload logo: ' + uploadError.message)
          return
        }

        logoFilename = fileName
      }

      if (editingPartnerId) {
        // Update existing partner
        const updateData = {
          partner_name: partnerName.trim(),
          website_url: websiteUrl.trim() || null,
          display_order: parseInt(displayOrder) || 999,
          active: active
        }

        if (logoFilename) {
          // Get old logo filename to delete it
          const oldPartner = partners.find(p => p.partner_id === editingPartnerId)
          if (oldPartner?.partner_logo) {
            await supabase.storage
              .from('partners-images')
              .remove([oldPartner.partner_logo])
          }
          updateData.partner_logo = logoFilename
        }

        const { error } = await supabase
          .from('partners')
          .update(updateData)
          .eq('partner_id', editingPartnerId)

        if (error) throw error
        setPartnerSuccess('Partner updated successfully!')
      } else {
        // Create new partner
        if (!logoFilename) {
          setPartnerError('Logo is required for new partners.')
          return
        }

        const { error } = await supabase
          .from('partners')
          .insert({
            partner_name: partnerName.trim(),
            partner_logo: logoFilename,
            website_url: websiteUrl.trim() || null,
            display_order: parseInt(displayOrder) || 999,
            active: active
          })

        if (error) throw error
        setPartnerSuccess('Partner added successfully!')
      }

      await loadPartners()
      setTimeout(() => {
        setShowPartnerModal(false)
        setPartnerSuccess('')
      }, 2000)
    } catch (err) {
      console.error('Error saving partner:', err)
      setPartnerError(err.message || 'Failed to save partner.')
    }
  }

  const handleDeletePartner = async (partnerId) => {
    if (!window.confirm('Are you sure you want to delete this partner? This cannot be undone.')) {
      return
    }

    try {
      const partner = partners.find(p => p.partner_id === partnerId)
      
      // Delete logo from storage
      if (partner?.partner_logo) {
        await supabase.storage
          .from('partners-images')
          .remove([partner.partner_logo])
      }

      // Delete partner from database
      const { error } = await supabase
        .from('partners')
        .delete()
        .eq('partner_id', partnerId)

      if (error) throw error

      await loadPartners()
    } catch (err) {
      console.error('Error deleting partner:', err)
      alert('Failed to delete partner: ' + err.message)
    }
  }

  // School management handlers
  const handleAddSchool = () => {
    setEditingSchoolId(null)
    setSchoolForm({
      schoolName: '',
      displayOrder: 999,
      active: true
    })
    setSchoolLogoFile(null)
    setSchoolError('')
    setSchoolSuccess('')
    setShowSchoolModal(true)
  }

  const handleEditSchool = (school) => {
    setEditingSchoolId(school.school_id ?? school.id)
    setSchoolForm({
      schoolName: school.school_name,
      displayOrder: school.display_order || 999,
      active: school.active !== false
    })
    setSchoolLogoFile(null)
    setSchoolError('')
    setSchoolSuccess('')
    setShowSchoolModal(true)
  }

  const handleSaveSchool = async () => {
    const { schoolName, displayOrder, active } = schoolForm
    setSchoolError('')
    setSchoolSuccess('')

    if (!schoolName.trim()) {
      setSchoolError('School name is required.')
      return
    }

    try {
      let logoFilename = null

      // Upload logo if a new file was selected
      if (schoolLogoFile) {
        const fileExt = schoolLogoFile.name.split('.').pop()
        const fileName = `${Date.now()}-${schoolName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}.${fileExt}`
        
        const { error: uploadError } = await supabase.storage
          .from('schools-images')
          .upload(fileName, schoolLogoFile, {
            cacheControl: '3600',
            upsert: false
          })

        if (uploadError) {
          console.error('Error uploading logo:', uploadError)
          setSchoolError('Failed to upload logo: ' + uploadError.message)
          return
        }

        logoFilename = fileName
      }

      if (editingSchoolId) {
        // Update existing school (logo optional — keep current if not changed)
        const updateData = {
          school_name: schoolName.trim(),
          display_order: parseInt(displayOrder) || 999,
          active: active !== false
        }

        if (logoFilename) {
          const oldSchool = schools.find(s => (s.school_id ?? s.id) === editingSchoolId)
          if (oldSchool?.school_image) {
            await supabase.storage
              .from('schools-images')
              .remove([oldSchool.school_image])
          }
          updateData.school_image = logoFilename
        }

        const { error } = await supabase
          .from('schools')
          .update(updateData)
          .eq('school_id', editingSchoolId)

        if (error) throw error
        setSchoolSuccess('School updated successfully!')
      } else {
        // Create new school
        if (!logoFilename) {
          setSchoolError('Logo is required for new schools.')
          return
        }

        const { error } = await supabase
          .from('schools')
          .insert({
            school_name: schoolName.trim(),
            school_image: logoFilename,
            display_order: parseInt(displayOrder) || 999,
            active: active !== false
          })

        if (error) throw error
        setSchoolSuccess('School added successfully!')
      }

      await loadSchools()
      setTimeout(() => {
        setShowSchoolModal(false)
        setSchoolSuccess('')
      }, 2000)
    } catch (err) {
      console.error('Error saving school:', err)
      setSchoolError(err.message || 'Failed to save school.')
    }
  }

  const handleDeleteSchool = async (schoolId) => {
    if (!window.confirm('Are you sure you want to delete this school? This cannot be undone.')) {
      return
    }

    try {
      const school = schools.find(s => (s.school_id ?? s.id) === schoolId)
      
      // Delete logo from storage
      if (school?.school_image) {
        await supabase.storage
          .from('schools-images')
          .remove([school.school_image])
      }

      // Delete school from database
      const { error } = await supabase
        .from('schools')
        .delete()
        .eq('school_id', schoolId)

      if (error) throw error

      await loadSchools()
    } catch (err) {
      console.error('Error deleting school:', err)
      alert('Failed to delete school: ' + err.message)
    }
  }

  // Drag and drop handlers for schools
  const handleSchoolDragStart = (e, schoolId) => {
    setDraggedSchoolId(schoolId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', schoolId.toString())
    e.currentTarget.style.opacity = '0.5'
    e.currentTarget.style.cursor = 'grabbing'
  }

  const handleSchoolDragEnd = (e) => {
    e.currentTarget.style.opacity = '1'
    e.currentTarget.style.cursor = 'move'
    setDraggedSchoolId(null)
  }

  const handleSchoolDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleSchoolDrop = async (e, targetSchoolId) => {
    e.preventDefault()
    if (!draggedSchoolId || draggedSchoolId === targetSchoolId) {
      setDraggedSchoolId(null)
      return
    }

    const schoolPk = s => s.school_id ?? s.id
    const draggedIndex = schools.findIndex(s => schoolPk(s) === draggedSchoolId)
    const targetIndex = schools.findIndex(s => schoolPk(s) === targetSchoolId)

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedSchoolId(null)
      return
    }

    // Reorder schools array
    const newSchools = [...schools]
    const [removed] = newSchools.splice(draggedIndex, 1)
    newSchools.splice(targetIndex, 0, removed)

    // Update display_order for all affected schools
    const updates = newSchools.map((school, index) => ({
      school_id: schoolPk(school),
      display_order: index + 1
    }))

    try {
      await Promise.all(
        updates.map(update =>
          supabase
            .from('schools')
            .update({ display_order: update.display_order })
            .eq('school_id', update.school_id)
        )
      )

      await loadSchools()
    } catch (err) {
      console.error('Error reordering schools:', err)
      alert('Failed to reorder schools: ' + err.message)
    }

    setDraggedSchoolId(null)
  }

  // Drag and drop handlers for partners
  const handlePartnerDragStart = (e, partnerId) => {
    setDraggedPartnerId(partnerId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', partnerId.toString())
    e.currentTarget.style.opacity = '0.5'
    e.currentTarget.style.cursor = 'grabbing'
  }

  const handlePartnerDragEnd = (e) => {
    e.currentTarget.style.opacity = '1'
    e.currentTarget.style.cursor = 'move'
    setDraggedPartnerId(null)
  }

  const handlePartnerDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handlePartnerDrop = async (e, targetPartnerId) => {
    e.preventDefault()
    if (!draggedPartnerId || draggedPartnerId === targetPartnerId) {
      setDraggedPartnerId(null)
      return
    }

    const draggedIndex = partners.findIndex(p => p.partner_id === draggedPartnerId)
    const targetIndex = partners.findIndex(p => p.partner_id === targetPartnerId)

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedPartnerId(null)
      return
    }

    // Reorder partners array
    const newPartners = [...partners]
    const [removed] = newPartners.splice(draggedIndex, 1)
    newPartners.splice(targetIndex, 0, removed)

    // Update display_order for all affected partners
    const updates = newPartners.map((partner, index) => ({
      partner_id: partner.partner_id,
      display_order: index + 1
    }))

    try {
      // Update all partners in parallel
      await Promise.all(
        updates.map(update =>
          supabase
            .from('partners')
            .update({ display_order: update.display_order })
            .eq('partner_id', update.partner_id)
        )
      )

      await loadPartners()
    } catch (err) {
      console.error('Error reordering partners:', err)
      alert('Failed to reorder partners: ' + err.message)
    }

    setDraggedPartnerId(null)
  }

  const handleAddAdvisor = () => {
    setEditingAdvisorId(null)
    setAdvisorForm({
      fullName: '',
      title: '',
      company: '',
      linkedinUrl: '',
      displayOrder: 999,
      active: true,
    })
    setAdvisorPhotoFile(null)
    setAdvisorError('')
    setAdvisorSuccess('')
    setShowAdvisorModal(true)
  }

  const handleEditAdvisor = (advisor) => {
    setEditingAdvisorId(advisor.advisor_id)
    setAdvisorForm({
      fullName: advisor.full_name || '',
      title: advisor.title || '',
      company: advisor.company || '',
      linkedinUrl: advisor.linkedin_url || '',
      displayOrder: advisor.display_order || 999,
      active: advisor.active !== false,
    })
    setAdvisorPhotoFile(null)
    setAdvisorError('')
    setAdvisorSuccess('')
    setShowAdvisorModal(true)
  }

  const handleSaveAdvisor = async () => {
    const { fullName, title, company, linkedinUrl, displayOrder, active } = advisorForm
    setAdvisorError('')
    setAdvisorSuccess('')

    if (!fullName.trim()) {
      setAdvisorError('Full name is required.')
      return
    }

    try {
      let photoFilename = null

      if (advisorPhotoFile) {
        const fileExt = advisorPhotoFile.name.split('.').pop()
        const fileName = `${Date.now()}-${fullName.replace(/[^a-zA-Z0-9]/g, '_')}.${fileExt}`

        const { error: uploadError } = await supabase.storage
          .from('advisors-images')
          .upload(fileName, advisorPhotoFile, {
            cacheControl: '3600',
            upsert: false,
          })

        if (uploadError) {
          console.error('Error uploading advisor photo:', uploadError)
          setAdvisorError('Failed to upload photo: ' + uploadError.message)
          return
        }

        photoFilename = fileName
      }

      if (editingAdvisorId) {
        const updateData = {
          full_name: fullName.trim(),
          title: title.trim() || null,
          company: company.trim() || null,
          linkedin_url: linkedinUrl.trim() || null,
          display_order: parseInt(displayOrder, 10) || 999,
          active,
        }

        if (photoFilename) {
          const oldAdvisor = advisors.find((a) => a.advisor_id === editingAdvisorId)
          if (oldAdvisor?.photo) {
            await supabase.storage.from('advisors-images').remove([oldAdvisor.photo])
          }
          updateData.photo = photoFilename
        }

        const { error } = await supabase
          .from('advisors')
          .update(updateData)
          .eq('advisor_id', editingAdvisorId)

        if (error) throw error
        setAdvisorSuccess('Mentor updated successfully!')
      } else {
        if (!photoFilename) {
          setAdvisorError('Photo is required for new mentors.')
          return
        }

        const { error } = await supabase.from('advisors').insert({
          full_name: fullName.trim(),
          title: title.trim() || null,
          company: company.trim() || null,
          linkedin_url: linkedinUrl.trim() || null,
          photo: photoFilename,
          display_order: parseInt(displayOrder, 10) || 999,
          active,
        })

        if (error) throw error
        setAdvisorSuccess('Mentor added successfully!')
      }

      await loadAdvisors()
      setTimeout(() => {
        setShowAdvisorModal(false)
        setAdvisorSuccess('')
      }, 2000)
    } catch (err) {
      console.error('Error saving advisor:', err)
      setAdvisorError(err.message || 'Failed to save advisor.')
    }
  }

  const handleDeleteAdvisor = async (advisorId) => {
    if (!window.confirm('Are you sure you want to delete this mentor? This cannot be undone.')) {
      return
    }

    try {
      const advisor = advisors.find((a) => a.advisor_id === advisorId)
      if (advisor?.photo) {
        await supabase.storage.from('advisors-images').remove([advisor.photo])
      }

      const { error } = await supabase.from('advisors').delete().eq('advisor_id', advisorId)
      if (error) throw error

      await loadAdvisors()
    } catch (err) {
      console.error('Error deleting advisor:', err)
      alert('Failed to delete mentor: ' + err.message)
    }
  }

  const handleProvisionMentorLogin = async (advisorId, action = 'provision') => {
    if (!advisorId) return
    const label = action === 'reset_password' ? 'reset this mentor’s password' : 'create a login for this mentor'
    if (!window.confirm(`Are you sure you want to ${label}?`)) return
    setMentorProvisionBusyId(advisorId)
    try {
      const result = await provisionMentorLogin(advisorId, action)
      setMentorCredentialsModal(result)
      await loadAdvisors()
    } catch (err) {
      console.error('Mentor provision failed:', err)
      alert(err.message || 'Failed to provision mentor login.')
    } finally {
      setMentorProvisionBusyId(null)
    }
  }

  const handleAdvisorDragStart = (e, advisorId) => {
    setDraggedAdvisorId(advisorId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleAdvisorDragEnd = () => {
    setDraggedAdvisorId(null)
  }

  const handleAdvisorDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleAdvisorDrop = async (e, targetAdvisorId) => {
    e.preventDefault()
    if (!draggedAdvisorId || draggedAdvisorId === targetAdvisorId) {
      setDraggedAdvisorId(null)
      return
    }

    const draggedIndex = advisors.findIndex((a) => a.advisor_id === draggedAdvisorId)
    const targetIndex = advisors.findIndex((a) => a.advisor_id === targetAdvisorId)
    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedAdvisorId(null)
      return
    }

    const newAdvisors = [...advisors]
    const [removed] = newAdvisors.splice(draggedIndex, 1)
    newAdvisors.splice(targetIndex, 0, removed)

    const updates = newAdvisors.map((advisor, index) => ({
      advisor_id: advisor.advisor_id,
      display_order: index + 1,
    }))

    try {
      await Promise.all(
        updates.map((update) =>
          supabase
            .from('advisors')
            .update({ display_order: update.display_order })
            .eq('advisor_id', update.advisor_id)
        )
      )
      await loadAdvisors()
    } catch (err) {
      console.error('Error reordering advisors:', err)
      alert('Failed to reorder advisors: ' + err.message)
    }

    setDraggedAdvisorId(null)
  }

  const handleEditBillCollaboratorToggle = (memberId) => {
    const member = allMembers.find(m => m.member_id === memberId)
    if (!member) return

    const fullName = `${member.first_name} ${member.last_name}`
    const current = editBillForm.collaborators || []
    
    if (current.includes(fullName)) {
      setEditBillForm({
        ...editBillForm,
        collaborators: current.filter(name => name !== fullName)
      })
    } else {
      setEditBillForm({
        ...editBillForm,
        collaborators: [...current, fullName]
      })
    }
  }

  const assignPrefillBillChoices = useMemo(() => {
    return [...(allBills || [])].sort((a, b) => {
      const sa = canonicalUSStateName(a.state) || String(a.state || '')
      const sb = canonicalUSStateName(b.state) || String(b.state || '')
      if (sa !== sb) return sa.localeCompare(sb)
      return String(a.name || '').localeCompare(String(b.name || ''))
    })
  }, [allBills])

  if (loading) {
    return (
      <div className="container my-5 text-center">
        <div className="spinner-border" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    )
  }

  // Handler to refresh member data after registration
  const handleRegistrationComplete = async () => {
    await loadMemberData()
  }

  if (!member) {
    return (
      <div className="container my-5">
        <div className="alert alert-danger">Failed to load member data.</div>
      </div>
    )
  }

  // Show registration form if registration is not complete
  if (!member.registration_complete) {
    return (
      <div className="container my-5">
        <div className="row justify-content-center">
          <div className="col-lg-8">
            <RegistrationForm member={member} onComplete={handleRegistrationComplete} />
          </div>
        </div>
      </div>
    )
  }

  const effectiveMember = viewAsData?.member ?? member
  const dashboardDisplayName = memberSiteDisplayName(effectiveMember)

  // SVG filenames under /images/states/ — align with canonical state names
  const getStateFileName = (state) => {
    if (!state) return 'United States'
    const c = canonicalUSStateName(state)
    if (c) return c
    return String(state).trim() || 'United States'
  }

  const effectiveVolunteerEntries = viewAsData ? (viewAsData.volunteer_entries ?? []) : volunteerEntries
  const approvedToFilter = () => (volunteerFilter === 'pending' ? 'waiting' : volunteerFilter === 'declined' ? 'denied' : volunteerFilter)
  const filteredVolunteerEntries = volunteerFilter === 'all'
    ? effectiveVolunteerEntries
    : effectiveVolunteerEntries.filter(e => e.approved === approvedToFilter())

  const effectiveBills = viewAsData ? (viewAsData.bills ?? []) : hasPermission('bills') ? allBills : []
  /** Under review, approved, modified, or outreach-only stubs (plus legacy unset). Not rejected. */
  const execOutreachBills = effectiveBills.filter((b) => {
    if (b.status === 'rejected') return false
    const s = b.status
    return (
      s === 'under_review' ||
      s === 'approved' ||
      s === 'modified' ||
      s === 'outreach_only' ||
      s == null ||
      s === ''
    )
  })

  const effectiveRequests = viewAsData
    ? (viewAsData.leave_requests ?? [])
    : isExec || isTeamLeadUser
      ? filteredMemberRequests
      : myRequests
  const effectiveApplications = viewAsData ? (viewAsData.applications ?? []) : applications
  const filteredEffectiveApplications = applicationFilter === 'all' ? effectiveApplications : effectiveApplications.filter(app => app.status === applicationFilter)

  /** View-as: only show Assigned to me in Bill Submission; members keep tab state. */
  const billSubmissionViewTab = viewAsData ? 'assigned_to_me' : memberBillSectionTab

  // Group volunteer entries by member_id (use filtered list)
  const groupedEntries = {}
  filteredVolunteerEntries.forEach(entry => {
    if (!groupedEntries[entry.member_id]) {
      groupedEntries[entry.member_id] = []
    }
    groupedEntries[entry.member_id].push(entry)
  })

  // Group bills by state (CA / California / california → one bucket)
  const billsByState = {}
  effectiveBills.forEach(bill => {
    const state = billStateGroupKey(bill.state)
    if (!billsByState[state]) {
      billsByState[state] = []
    }
    billsByState[state].push(bill)
  })
  
  // Sort states alphabetically
  const sortedStates = Object.keys(billsByState).sort((a, b) => {
    // Put "Unknown" at the end
    if (a === 'Unknown') return 1
    if (b === 'Unknown') return -1
    return a.localeCompare(b)
  })

  return (
    <div className="dashboard-page" data-bs-theme={dashboardTheme}>
      <section className="subpage-hero d-flex align-items-center text-white text-center position-relative">
        <div className="parallax-bg" aria-hidden="true"></div>
        <div className="container position-relative z-1">
          <h1 className="display-3 fw-bold mb-2" data-aos="fade-up">Dashboard</h1>
          <p className="lead" data-aos="fade-up" data-aos-delay="200">
            {isMentor ? 'Mentor access to SPAN policy tools.' : 'Manage your SPAN membership.'}
          </p>
        </div>
      </section>

      <button
        type="button"
        className={`btn dashboard-theme-toggle ${dashboardTheme === 'dark' ? 'btn-light' : 'btn-dark'}`}
        onClick={toggleDashboardTheme}
        title={dashboardTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label={dashboardTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        <i className={`bi ${dashboardTheme === 'dark' ? 'bi-sun-fill' : 'bi-moon-stars-fill'}`} aria-hidden="true" />
      </button>

      <div className="container my-5">
        {/* View-as mode: banner and loading/error */}
        {viewAsLoading && new URLSearchParams(window.location.search).get('viewAs') && (
          <div className="alert alert-info d-flex align-items-center gap-2">
            <span className="spinner-border spinner-border-sm" />
            Loading this member&apos;s dashboard...
          </div>
        )}
        {viewAsError && (
          <div className="alert alert-warning d-flex align-items-center justify-content-between flex-wrap gap-2">
            <span>{viewAsError}</span>
            <a href="/dashboard" className="btn btn-sm btn-outline-dark">Exit view</a>
          </div>
        )}
        {viewAsData && !viewAsError && (
          <div className="alert alert-dark d-flex align-items-center justify-content-between flex-wrap gap-2 mb-4">
            <span>
              <i className="bi bi-person-badge me-2" />
              Viewing dashboard as <strong>{dashboardDisplayName}</strong>
            </span>
            <a href="/dashboard" className="btn btn-sm btn-light text-dark">Exit view</a>
          </div>
        )}

        <DashboardSectionNav items={dashboardSectionNavItems} />

        {/* Profile Header */}
        {isMentor ? (
          <div className="text-center mb-5">
            {effectiveMember.image ? (
              <img
                src={`${ADVISORS_IMAGES_BASE_URL}/${effectiveMember.image}`}
                className="rounded-circle border border-dark border-3 mb-3"
                alt=""
                style={{ width: '120px', height: '120px', objectFit: 'cover' }}
              />
            ) : null}
            <h2 className="mb-1">{dashboardDisplayName}</h2>
            <p className="text-muted mb-1">Board Mentor</p>
            {member.username && (
              <p className="small text-muted mb-0">
                Username: <span className="font-monospace">{member.username}</span>
              </p>
            )}
          </div>
        ) : (
        <div className="text-center mb-5">
          <input
            ref={profilePicInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="d-none"
            onChange={handleProfilePicChange}
          />
          <div className="position-relative d-inline-block mb-3">
            {effectiveMember.image ? (
              <img
                src={`${IMAGE_BASE_URL}/${effectiveMember.image}${!viewAsData && profilePicVersion ? `?v=${profilePicVersion}` : ''}`}
                className="rounded-circle border border-dark border-3"
                alt="Profile"
                style={{ width: '150px', height: '150px', objectFit: 'cover' }}
              />
            ) : (
              <div
                className="rounded-circle border border-dark border-3 d-flex align-items-center justify-content-center bg-light text-dark"
                style={{ width: '150px', height: '150px', fontSize: '3rem' }}
              >
                {effectiveMember.first_name?.[0]}{effectiveMember.last_name?.[0]}
              </div>
            )}
            {!viewAsData && (
              <button
                type="button"
                className="btn btn-sm btn-dark position-absolute bottom-0 end-0 rounded-circle p-2"
                style={{ width: '36px', height: '36px' }}
                onClick={handleProfilePicClick}
                disabled={profilePicLoading}
                title="Change profile picture"
                aria-label="Change profile picture"
              >
                {profilePicLoading ? (
                  <span className="spinner-border spinner-border-sm" style={{ width: '14px', height: '14px' }} />
                ) : (
                  <i className="bi bi-camera-fill" style={{ fontSize: '0.9rem' }} aria-hidden="true" />
                )}
              </button>
            )}
          </div>
          {!viewAsData && profilePicError && (
            <div className="small text-danger mb-1">{profilePicError}</div>
          )}
          {!viewAsData && profilePicSuccess && (
            <div className="small text-success mb-1">{profilePicSuccess}</div>
          )}
          {!viewAsData && (
            <div className="small text-muted mb-1">
              <button type="button" className="btn btn-link btn-sm p-0 text-muted" onClick={handleProfilePicClick}>
                Change profile picture
              </button>
            </div>
          )}
          {preferredNameEditOpen && !viewAsData ? (
            <div className="mx-auto mt-1" style={{ maxWidth: '420px', width: '100%' }}>
              <label className="form-label small text-muted mb-1" htmlFor="dashboard-preferred-name-input">
                Preferred public name (directory and blog)
              </label>
              <input
                id="dashboard-preferred-name-input"
                type="text"
                className="form-control text-center"
                value={preferredNameDraft}
                onChange={(e) => setPreferredNameDraft(e.target.value)}
                placeholder="Leave blank to use your legal first / middle / last"
                disabled={preferredNameSaving}
                autoComplete="name"
              />
              <p className="small text-muted mt-2 mb-2">
                Your SPAN email stays first.last. Execs can also set this in Member Management.
              </p>
              <div className="d-flex gap-2 justify-content-center flex-wrap">
                <button
                  type="button"
                  className="btn btn-sm btn-dark"
                  onClick={handleSavePreferredPublicName}
                  disabled={preferredNameSaving}
                >
                  {preferredNameSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={handleCancelPreferredNameEdit}
                  disabled={preferredNameSaving}
                >
                  Cancel
                </button>
              </div>
              {preferredNameError && <div className="small text-danger mt-2">{preferredNameError}</div>}
            </div>
          ) : (
            <div className="d-flex align-items-center justify-content-center gap-1 flex-wrap">
              <h2 className="mb-0">{dashboardDisplayName}</h2>
              {!viewAsData && (
                <button
                  type="button"
                  className="btn btn-link text-dark p-1 lh-1"
                  onClick={() => {
                    setPreferredNameDraft(member?.preferred_name ?? '')
                    setPreferredNameError('')
                    setPreferredNameSuccess('')
                    setPreferredNameEditOpen(true)
                  }}
                  title="Edit preferred public name"
                  aria-label="Edit preferred public name"
                >
                  <i className="bi bi-pencil-square fs-4" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          {preferredNameSuccess && !preferredNameEditOpen && (
            <div className="small text-success mt-1">{preferredNameSuccess}</div>
          )}
          <p className="text-muted">{effectiveMember.role || '-'}</p>
          <div className="mt-2">
            {effectiveMember.linkedin && (
              <a
                href={effectiveMember.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="text-dark fs-4 me-2"
                aria-label="LinkedIn profile"
              >
                <i className="bi bi-linkedin" aria-hidden="true"></i>
              </a>
            )}
            {effectiveMember.instagram && (
              <a
                href={effectiveMember.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="text-dark fs-4"
                aria-label="Instagram profile"
              >
                <i className="bi bi-instagram" aria-hidden="true"></i>
              </a>
            )}
          </div>
          {!viewAsData && (
            <button className="btn btn-dark mt-3" onClick={handleDownloadSpanCard}>
              <i className="bi bi-person-vcard"></i> Download My SPANCard
            </button>
          )}
        </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column' }}>
        {!isMentor && (
        <YourInfoSection
          sectionId={DASHBOARD_SECTION_IDS.yourInfo}
          sectionOrder={dashboardOrder.yourInfo}
          effectiveMember={effectiveMember}
          viewAsData={viewAsData}
          formatDate={formatDate}
          formatPhone={formatPhone}
          onMemberInfoUpdated={handleMemberInfoUpdated}
        />
        )}

        <Suspense fallback={<DashboardLazyFallback label="Loading dashboard panels…" />}>
        {!isMentor && (
        <LeaveExtensionSection
          sectionId={DASHBOARD_SECTION_IDS.leaveExtension}
          sectionOrder={dashboardOrder.leaveExtension}
          leaveExtensionViewMode={leaveExtensionViewMode}
          setLeaveExtensionViewMode={setLeaveExtensionViewMode}
          viewAsData={viewAsData}
          showExecRequestFilters={!viewAsData && (isExec || isTeamLeadUser)}
          showRequestTeamFilter={!viewAsData && isExec}
          memberRequestFilter={memberRequestFilter}
          setMemberRequestFilter={setMemberRequestFilter}
          memberRequestTeamFilter={memberRequestTeamFilter}
          setMemberRequestTeamFilter={setMemberRequestTeamFilter}
          memberRequestTeamFilterOptions={memberRequestTeamFilterOptions}
          resolveRequestTeamName={(req) => memberTeamNameById[String(req.member_id)] || 'Unassigned teams'}
          allMemberRequests={allMemberRequests}
          effectiveRequests={effectiveRequests}
          formatDate={formatDate}
          formatDateLong={formatDateLong}
          birthdayRows={calendarBirthdayRows}
          calendarEvents={dashboardCalendarEvents}
          teamNameById={calendarTeamNameById}
          canAddSpanEvent={!viewAsData && isExec}
          canAddDeadline={!viewAsData && (isExec || isTeamLeadUser) && deadlineTeamOptions.length > 0}
          deadlineTeamOptions={deadlineTeamOptions}
          canEditCalendarEvent={canEditCalendarEvent}
          canDeleteCalendarEvent={canEditCalendarEvent}
          onSaveCalendarEvent={handleSaveCalendarEvent}
          onDeleteCalendarEvent={handleDeleteCalendarEvent}
          onOpenNewRequest={() => {
            setRequestError('')
            setRequestSuccess('')
            setRequestForm({
              type: 'leave',
              reason: '',
              leaveStart: '',
              leaveEnd: '',
              projectName: '',
              requestedByDate: '',
            })
            setShowRequestModal(true)
          }}
          onViewRequest={openRequestViewModal}
        />
        )}

        {!isMentor && (
        <IdeasSuggestionsSection
          sectionId={DASHBOARD_SECTION_IDS.ideasSuggestions}
          sectionOrder={dashboardOrder.ideasSuggestions}
          viewAsData={viewAsData}
          isExec={isExec}
          suggestionForm={suggestionForm}
          setSuggestionForm={setSuggestionForm}
          suggestionError={suggestionError}
          suggestionSuccess={suggestionSuccess}
          onSubmitSuggestion={handleSubmitSuggestion}
          suggestionFilter={suggestionFilter}
          setSuggestionFilter={setSuggestionFilter}
          suggestionSourceFilter={suggestionSourceFilter}
          setSuggestionSourceFilter={setSuggestionSourceFilter}
          allSuggestions={allSuggestions}
          effectiveSuggestions={effectiveSuggestions}
          formatDateLong={formatDateLong}
          onViewSuggestion={openSuggestionViewModal}
        />
        )}

        {!isMentor && (
        <VolunteerHoursSection
          sectionId={DASHBOARD_SECTION_IDS.volunteerHours}
          sectionOrder={dashboardOrder.volunteerHours}
          volunteerFilter={volunteerFilter}
          setVolunteerFilter={setVolunteerFilter}
          effectiveVolunteerEntries={effectiveVolunteerEntries}
          groupedEntries={groupedEntries}
          viewAsData={viewAsData}
          effectiveMember={effectiveMember}
          formatDuration={formatDuration}
          formatDateLong={formatDateLong}
          onAddEntry={handleAddVolunteer}
          canSuperviseVolunteerHours={hasPermission('volunteer')}
          canExecVolunteerActions={
            hasPermission('volunteer') &&
            hasPermission('applications') &&
            hasPermission('bills') &&
            hasPermission('registration')
          }
          verificationGenerating={verificationGenerating}
          onApproveEntry={handleApproveEntry}
          onDenyEntry={handleDenyEntry}
          onCommentEntry={handleCommentEntry}
          onRequestDeleteEntry={(id) => {
            setSelectedEntryId(id)
                                          setShowDeleteModal(true)
                                        }}
          onSendVerification={handleSendVerification}
        />
        )}

        {/* Bill Management Section - full exec tools (all 4 permissions) */}
        {(() => {
          const isExecUser = hasPermission('volunteer') && hasPermission('applications') && hasPermission('bills') && hasPermission('registration')
          return isExecUser
        })() && (
          <ExecBillManagementSection
            sectionId={DASHBOARD_SECTION_IDS.billManagement}
            sectionOrder={dashboardOrder.billManagement}
            execBillSectionTab={execBillSectionTab}
            setExecBillSectionTab={setExecBillSectionTab}
            execOutreachBills={execOutreachBills}
            member={member}
            loadAllBills={loadAllBills}
            researchBills={researchBills}
            researchBillsLoading={researchBillsLoading}
            researchBillsError={researchBillsError}
            researchBillSearchState={researchBillSearchState}
            setResearchBillSearchState={setResearchBillSearchState}
            researchBillSearchNumber={researchBillSearchNumber}
            setResearchBillSearchNumber={setResearchBillSearchNumber}
            researchBillSearchKeywords={researchBillSearchKeywords}
            setResearchBillSearchKeywords={setResearchBillSearchKeywords}
            researchBillStatusFilter={researchBillStatusFilter}
            setResearchBillStatusFilter={setResearchBillStatusFilter}
                allMembers={allMembers}
                getBillPdfUrl={getBillPdfUrl}
                formatDate={formatDate}
            loadResearchBills={loadResearchBills}
                getStateFileName={getStateFileName}
            billFilter={billFilter}
            setBillFilter={setBillFilter}
            effectiveBills={effectiveBills}
            viewAsData={viewAsData}
            handleAddBill={handleAddBill}
            setBillPdfPreviewBill={setBillPdfPreviewBill}
            handleApproveBill={handleApproveBill}
            handleModifyAndApproveBill={handleModifyAndApproveBill}
            handleRejectBill={handleRejectBill}
            setSelectedBillForEdit={setSelectedBillForEdit}
            setEditBillForm={setEditBillForm}
            setEditBillPdfFile={setEditBillPdfFile}
            setBillError={setBillError}
            setBillSuccess={setBillSuccess}
            setShowEditBillModal={setShowEditBillModal}
            setSelectedBillForDelete={setSelectedBillForDelete}
            setShowDeleteBillModal={setShowDeleteBillModal}
            billAssignments={billAssignments}
            execAssignmentFilter={execAssignmentFilter}
            onExecAssignmentFilterChange={setExecAssignmentFilter}
            execAssignmentTeamFilter={execAssignmentTeamFilter}
            onExecAssignmentTeamFilterChange={setExecAssignmentTeamFilter}
            assignmentTeamFilterOptions={assignmentTeamFilterOptions}
            resolveAssignmentTeamLabel={assignmentTeamLabel}
            onOpenAssignWork={handleOpenAssignBillModal}
            resolveBillAssignmentMemberName={resolveBillAssignmentMemberName}
            resolveBillAssignmentMemberNames={resolveBillAssignmentMemberNames}
            onExecStatus={handleExecBillAssignmentStatus}
            onApproveAndPublish={handleExecApproveAssignment}
            onReopenPublish={handleReopenPublishBillFromAssignment}
            onEditAssignment={handleOpenEditAssignmentModal}
            onRequestDeleteAssignment={(a) => {
                                          setAssignmentToDelete(a)
                                          setDeleteAssignmentError('')
                                          setShowDeleteAssignmentModal(true)
                                        }}
            billProposalAiChecks={billProposalAiChecks}
            billProposalAiCheckLoadingId={billProposalAiCheckLoadingId}
            onCheckBillProposalAi={handleCheckBillProposalAi}
            assignmentAiChecks={assignmentAiChecks}
            assignmentAiCheckLoadingId={assignmentAiCheckLoadingId}
            onCheckAssignmentProposalAi={handleCheckAssignmentProposalAi}
          />
        )}

        {/* Policy team lead: assign work within team (RLS-scoped); not shown for full execs (they use Exec Bill Management). */}
        {isTeamLeadOnly && !viewAsData && hasPermission('bills') && (
          <TeamLeadAssignmentsSection
            sectionId={DASHBOARD_SECTION_IDS.billManagement}
            sectionOrder={dashboardOrder.billManagement}
            currentMemberId={member?.member_id}
            billAssignments={billAssignments}
            execAssignmentFilter={execAssignmentFilter}
            onExecAssignmentFilterChange={setExecAssignmentFilter}
            execAssignmentTeamFilter={execAssignmentTeamFilter}
            onExecAssignmentTeamFilterChange={setExecAssignmentTeamFilter}
            assignmentTeamFilterOptions={assignmentTeamFilterOptions}
            resolveAssignmentTeamLabel={assignmentTeamLabel}
            viewAsData={viewAsData}
            onOpenAssignWork={handleOpenAssignBillModal}
            formatDate={formatDate}
            resolveBillAssignmentMemberName={resolveBillAssignmentMemberName}
            resolveBillAssignmentMemberNames={resolveBillAssignmentMemberNames}
            onExecStatus={handleExecBillAssignmentStatus}
            onApproveAndPublish={handleExecApproveAssignment}
            onReopenPublish={handleReopenPublishBillFromAssignment}
            onEditAssignment={handleOpenEditAssignmentModal}
            onRequestDeleteAssignment={(a) => {
                                          setAssignmentToDelete(a)
                                          setDeleteAssignmentError('')
                                          setShowDeleteAssignmentModal(true)
                                        }}
          />
        )}

        {/* Bill Submission Section - bills permission or assignment-only members (non-exec); execs see this when viewing-as */}
        {(() => {
          const hasBills = hasPermission('bills')
          const isExecUser = hasPermission('volunteer') && hasPermission('applications') && hasPermission('bills') && hasPermission('registration')
          return (hasBills || memberHasAssignmentWork) && !isExecUser
        })() && (
          <BillSubmissionSection
            sectionId={DASHBOARD_SECTION_IDS.billSubmission}
            sectionOrder={dashboardOrder.billSubmission}
            viewAsData={viewAsData}
            effectiveMember={effectiveMember}
            memberBillSectionTab={memberBillSectionTab}
            setMemberBillSectionTab={setMemberBillSectionTab}
            billSubmissionViewTab={billSubmissionViewTab}
            handleAddBill={handleAddBill}
            researchBills={researchBills}
            researchBillsLoading={researchBillsLoading}
            researchBillsError={researchBillsError}
            researchBillSearchState={researchBillSearchState}
            setResearchBillSearchState={setResearchBillSearchState}
            researchBillSearchNumber={researchBillSearchNumber}
            setResearchBillSearchNumber={setResearchBillSearchNumber}
            researchBillSearchKeywords={researchBillSearchKeywords}
            setResearchBillSearchKeywords={setResearchBillSearchKeywords}
            researchBillStatusFilter={researchBillStatusFilter}
            setResearchBillStatusFilter={setResearchBillStatusFilter}
                allMembers={allMembers}
                getBillPdfUrl={getBillPdfUrl}
                formatDate={formatDate}
            loadResearchBills={loadResearchBills}
                getStateFileName={getStateFileName}
            billAssignments={billAssignments}
            handleClaimBillAssignment={handleClaimBillAssignment}
            resolveBillAssignmentMemberName={resolveBillAssignmentMemberName}
            memberAssignmentFilter={memberAssignmentFilter}
            setMemberAssignmentFilter={setMemberAssignmentFilter}
            effectiveMemberId={effectiveMember?.member_id}
            memberDeliverableInputs={memberDeliverableInputs}
            setMemberDeliverableInputs={setMemberDeliverableInputs}
            handleSaveAssignmentDeliverable={handleSaveAssignmentDeliverable}
            handleAssigneeAssignmentStatus={handleAssigneeAssignmentStatus}
            effectiveBills={effectiveBills}
            setBillPdfPreviewBill={setBillPdfPreviewBill}
            formatDateLong={formatDateLong}
            outreachBills={execOutreachBills}
            member={member}
            loadAllBills={loadAllBills}
            mentorOnly={isMentor}
          />
        )}

        {hasPermission('registration') && (
          <MemberManagementSection
            sectionId={DASHBOARD_SECTION_IDS.memberManagement}
            policyTeamsAdminSlot={
              !viewAsData && isExec ? (
                <ExecTeamsSection
                  policyTeams={policyTeams}
                  memberPolicyTeams={memberPolicyTeams}
                  allMembersForManagement={allMembersForManagement}
                  onRefresh={loadPolicyTeams}
                />
              ) : null
            }
            sectionStyleOrder={dashboardOrder.memberManagement}
            imageBaseUrl={IMAGE_BASE_URL}
            allMembersForManagement={allMembersForManagement}
            execMemberPhotoInputRef={execMemberPhotoInputRef}
            onExecPhotoFileChange={handleExecMemberPhotoFileChange}
            onAddMember={handleAddMember}
            memberPhotoError={memberPhotoError}
            memberPhotoSuccess={memberPhotoSuccess}
            memberPhotoLoading={memberPhotoLoading}
            memberPhotoTarget={memberPhotoTarget}
            formatDate={formatDate}
            formatPhone={formatPhone}
            showViewAsDashboardLink={
              hasPermission('volunteer') &&
              hasPermission('applications') &&
              hasPermission('bills') &&
              hasPermission('registration')
            }
            onChangeProfilePhoto={handleExecChangeMemberPhoto}
            onEditMember={handleEditMember}
            execStrikeUi={
              !viewAsData &&
              hasPermission('volunteer') &&
              hasPermission('applications') &&
              hasPermission('bills') &&
              hasPermission('registration')
            }
            strikeCountByMember={strikeCountByMember}
            strikeLimitForMemberRow={strikeLimitForMember}
            memberAtStrikeLimit={memberAtStrikeLimitRow}
            onOpenStrikeModal={(row) => {
              setStrikeModalMember(row)
              setShowStrikeModal(true)
            }}
            onOpenRemovalModal={(row) => {
              setRemovalModalMember(row)
              setShowRemovalModal(true)
            }}
            memberGradeFilter={memberGradeFilter}
            setMemberGradeFilter={setMemberGradeFilter}
          />
        )}

        {hasPermission('volunteer') &&
          hasPermission('applications') &&
          hasPermission('bills') &&
          hasPermission('registration') &&
          !viewAsData && (
          <ClassroomSection
            sectionId={DASHBOARD_SECTION_IDS.classroom}
            sectionOrder={dashboardOrder.classroom}
          />
        )}

        {/* Schools & Partners - Execs only */}
        {hasPermission('volunteer') && hasPermission('applications') && hasPermission('bills') && hasPermission('registration') && (
          <section
            id={DASHBOARD_SECTION_IDS.schoolsPartners}
            className="mt-5 dashboard-section-anchor"
            style={{ order: dashboardOrder.schoolsPartners }}
          >
            <h3 className="mb-4">Schools, Partners &amp; Mentors</h3>
            <div className="alert alert-info mb-4">
              <i className="bi bi-info-circle me-2"></i>
              Manage schools and partners on the homepage, and Board of Mentors on the Members page Leadership tab.
              You can provision mentor logins (username + password) so they can try Research and Outreach without seeing
              HR, applications, or other member sections.
            </div>

            <div className="row g-4">
              {/* Schools Column */}
              <div className={hasPermission('volunteer') && hasPermission('applications') && hasPermission('bills') && hasPermission('registration') ? 'col-md-6' : 'col-12'}>
                <div className="card h-100 shadow-sm">
                  <div className="card-header bg-white d-flex justify-content-between align-items-center">
                    <h5 className="mb-0">Schools</h5>
                    <button className="btn btn-sm btn-dark" onClick={handleAddSchool}>
                      <i className="bi bi-plus-circle me-1"></i>Add School
                    </button>
                  </div>
                  <div className="card-body" style={{ maxHeight: '500px', overflowY: 'auto', overflowX: 'hidden' }}>
                    {schools.length > 0 ? (
                      <div className="table-responsive">
                        <table className="table table-hover table-sm mb-0">
                          <thead>
                            <tr>
                              <th style={{ width: '30px' }}></th>
                              <th>Logo</th>
                              <th>Name</th>
                              <th>Active</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {schools.map(school => {
                              const schoolPk = school.school_id ?? school.id
                              return (
                              <tr 
                                key={schoolPk}
                                draggable
                                onDragStart={(e) => handleSchoolDragStart(e, schoolPk)}
                                onDragEnd={handleSchoolDragEnd}
                                onDragOver={handleSchoolDragOver}
                                onDrop={(e) => handleSchoolDrop(e, schoolPk)}
                                style={{ 
                                  cursor: 'move',
                                  opacity: draggedSchoolId === schoolPk ? 0.5 : 1
                                }}
                              >
                                <td>
                                  <i className="bi bi-grip-vertical text-muted" style={{ cursor: 'grab', userSelect: 'none' }}></i>
                                </td>
                                <td>
                                  {school.school_image && (
                                    <img
                                      src={`${SCHOOLS_IMAGES_BASE_URL}/${school.school_image}`}
                                      alt={school.school_name}
                                      style={{ maxHeight: '40px', maxWidth: '80px', objectFit: 'contain' }}
                                    />
                                  )}
                                </td>
                                <td>{school.school_name}</td>
                                <td>
                                  <span className={`badge ${school.active !== false ? 'bg-success' : 'bg-secondary'}`}>
                                    {school.active !== false ? 'Active' : 'Inactive'}
                                  </span>
                                </td>
                                <td>
                                  <div className="d-flex gap-1" onMouseDown={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-primary"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleEditSchool(school)
                                      }}
                                      title="Edit"
                                      aria-label={`Edit ${school.school_name || 'school'}`}
                                    >
                                      <i className="bi bi-pencil" aria-hidden="true"></i>
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-danger"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleDeleteSchool(schoolPk)
                                      }}
                                      title="Delete"
                                      aria-label={`Delete ${school.school_name || 'school'}`}
                                    >
                                      <i className="bi bi-trash" aria-hidden="true"></i>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center py-4 text-muted">
                        <i className="bi bi-building display-6 d-block mb-2"></i>
                        <p className="small mb-0">No schools found.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Partner Organizations Column - Execs only */}
              {hasPermission('volunteer') && hasPermission('applications') && hasPermission('bills') && hasPermission('registration') && (
              <div className="col-md-6">
                <div className="card h-100 shadow-sm">
                  <div className="card-header bg-white d-flex justify-content-between align-items-center">
                    <h5 className="mb-0">Partner Organizations</h5>
                    <button className="btn btn-sm btn-dark" onClick={handleAddPartner}>
                      <i className="bi bi-plus-circle me-1"></i>Add Partner
                    </button>
                  </div>
                  <div className="card-body" style={{ maxHeight: '500px', overflowY: 'auto', overflowX: 'hidden' }}>
                    {partners.length > 0 ? (
                      <div className="table-responsive">
                        <table className="table table-hover table-sm mb-0">
                          <thead>
                            <tr>
                              <th style={{ width: '30px' }}></th>
                              <th>Logo</th>
                              <th>Name</th>
                              <th>Status</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {partners.map(partner => (
                              <tr 
                                key={partner.partner_id}
                                draggable
                                onDragStart={(e) => handlePartnerDragStart(e, partner.partner_id)}
                                onDragEnd={handlePartnerDragEnd}
                                onDragOver={handlePartnerDragOver}
                                onDrop={(e) => handlePartnerDrop(e, partner.partner_id)}
                                style={{ 
                                  cursor: 'move',
                                  opacity: draggedPartnerId === partner.partner_id ? 0.5 : 1
                                }}
                              >
                                <td>
                                  <i className="bi bi-grip-vertical text-muted" style={{ cursor: 'grab', userSelect: 'none' }}></i>
                                </td>
                                <td>
                                  {partner.partner_logo && (
                                    <img
                                      src={`${PARTNERS_IMAGES_BASE_URL}/${partner.partner_logo}`}
                                      alt={partner.partner_name}
                                      style={{ maxHeight: '40px', maxWidth: '80px', objectFit: 'contain' }}
                                    />
                                  )}
                                </td>
                                <td>{partner.partner_name}</td>
                                <td>
                                  <span className={`badge ${partner.active ? 'bg-success' : 'bg-secondary'}`}>
                                    {partner.active ? 'Active' : 'Inactive'}
                                  </span>
                                </td>
                                <td>
                                  <div className="d-flex gap-1" onMouseDown={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-primary"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleEditPartner(partner)
                                      }}
                                      title="Edit"
                                      aria-label={`Edit ${partner.partner_name || 'partner'}`}
                                    >
                                      <i className="bi bi-pencil" aria-hidden="true"></i>
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-danger"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleDeletePartner(partner.partner_id)
                                      }}
                                      title="Delete"
                                      aria-label={`Delete ${partner.partner_name || 'partner'}`}
                                    >
                                      <i className="bi bi-trash" aria-hidden="true"></i>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center py-4 text-muted">
                        <i className="bi bi-handshake display-6 d-block mb-2"></i>
                        <p className="small mb-0">No partners found.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              )}
            </div>

            <div className="row g-4 mt-1">
              <div className="col-12">
                <div className="card shadow-sm">
                  <div className="card-header bg-white d-flex justify-content-between align-items-center">
                    <h5 className="mb-0">Board of Mentors</h5>
                    <button className="btn btn-sm btn-dark" onClick={handleAddAdvisor}>
                      <i className="bi bi-plus-circle me-1"></i>Add Mentor
                    </button>
                  </div>
                  <div className="card-body" style={{ maxHeight: '500px', overflowY: 'auto', overflowX: 'hidden' }}>
                    {advisors.length > 0 ? (
                      <div className="table-responsive">
                        <table className="table table-hover table-sm mb-0">
                          <thead>
                            <tr>
                              <th style={{ width: '30px' }}></th>
                              <th>Photo</th>
                              <th>Name</th>
                              <th>Title / Company</th>
                              <th>Status</th>
                              <th>Login</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {advisors.map((advisor) => {
                              const mentorLogin = mentorAccountsByAdvisorId[advisor.advisor_id]
                              return (
                              <tr
                                key={advisor.advisor_id}
                                draggable
                                onDragStart={(e) => handleAdvisorDragStart(e, advisor.advisor_id)}
                                onDragEnd={handleAdvisorDragEnd}
                                onDragOver={handleAdvisorDragOver}
                                onDrop={(e) => handleAdvisorDrop(e, advisor.advisor_id)}
                                style={{
                                  cursor: 'move',
                                  opacity: draggedAdvisorId === advisor.advisor_id ? 0.5 : 1,
                                }}
                              >
                                <td>
                                  <i className="bi bi-grip-vertical text-muted" style={{ cursor: 'grab', userSelect: 'none' }}></i>
                                </td>
                                <td>
                                  {advisor.photo ? (
                                    <img
                                      src={`${ADVISORS_IMAGES_BASE_URL}/${advisor.photo}`}
                                      alt={advisor.full_name}
                                      className="rounded-circle object-fit-cover"
                                      style={{ width: '40px', height: '40px' }}
                                    />
                                  ) : (
                                    <span className="text-muted small">—</span>
                                  )}
                                </td>
                                <td>{advisor.full_name}</td>
                                <td className="small text-muted">
                                  {[advisor.title, advisor.company].filter(Boolean).join(' · ') || '—'}
                                </td>
                                <td>
                                  <span className={`badge ${advisor.active ? 'bg-success' : 'bg-secondary'}`}>
                                    {advisor.active ? 'Active' : 'Inactive'}
                                  </span>
                                </td>
                                <td className="small">
                                  {mentorLogin?.username ? (
                                    <>
                                      <span className="badge bg-primary mb-1">Login ready</span>
                                      <div className="font-monospace text-muted">{mentorLogin.username}</div>
                                    </>
                                  ) : (
                                    <span className="text-muted">Not provisioned</span>
                                  )}
                                </td>
                                <td>
                                  <div className="d-flex gap-1 flex-wrap" onMouseDown={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-primary"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleEditAdvisor(advisor)
                                      }}
                                      title="Edit"
                                      aria-label={`Edit ${advisor.full_name || 'mentor'}`}
                                    >
                                      <i className="bi bi-pencil" aria-hidden="true"></i>
                                    </button>
                                    {mentorLogin?.username ? (
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-outline-dark"
                                        disabled={mentorProvisionBusyId === advisor.advisor_id}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleProvisionMentorLogin(advisor.advisor_id, 'reset_password')
                                        }}
                                        title="Reset password"
                                      >
                                        {mentorProvisionBusyId === advisor.advisor_id ? '…' : 'Reset password'}
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-dark"
                                        disabled={mentorProvisionBusyId === advisor.advisor_id || !advisor.active}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleProvisionMentorLogin(advisor.advisor_id, 'provision')
                                        }}
                                        title="Create mentor login"
                                      >
                                        {mentorProvisionBusyId === advisor.advisor_id ? '…' : 'Provision login'}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-danger"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleDeleteAdvisor(advisor.advisor_id)
                                      }}
                                      title="Delete"
                                      aria-label={`Delete ${advisor.full_name || 'mentor'}`}
                                    >
                                      <i className="bi bi-trash" aria-hidden="true"></i>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center py-4 text-muted">
                        <i className="bi bi-people display-6 d-block mb-2"></i>
                        <p className="small mb-0">No mentors yet. Add the first Board of Mentors member.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {hasPermission('volunteer') &&
          hasPermission('applications') &&
          hasPermission('bills') &&
          hasPermission('registration') &&
          !viewAsData && (
            <AnalyticsSection
              sectionId={DASHBOARD_SECTION_IDS.analytics}
              sectionOrder={dashboardOrder.analytics}
            />
          )}

        {hasPermission('applications') && (
          <ApplicationsSection
            sectionId={DASHBOARD_SECTION_IDS.applications}
            sectionOrder={dashboardOrder.applications}
            applicationFilter={applicationFilter}
            setApplicationFilter={setApplicationFilter}
            effectiveApplications={effectiveApplications}
            filteredEffectiveApplications={filteredEffectiveApplications}
            formatDateLong={formatDateLong}
            onViewApplication={handleViewApplication}
            onSetMetWithAt={handleSetMetWithAt}
            onFollowUp={openFollowUpPreviewModal}
            followUpSendingId={followUpSending ? followUpApplication?.application_id : null}
          />
        )}

        {!isMentor && (
        <HrReportsSection
          sectionId={DASHBOARD_SECTION_IDS.hrReports}
          sectionOrder={dashboardOrder.hrReports}
          hrReportFilter={hrReportFilter}
          setHrReportFilter={setHrReportFilter}
          effectiveHrReports={effectiveHrReports}
          filteredHrReports={filteredHrReports}
          viewAsData={viewAsData}
          memberLoaded={!!member}
          isExec={
            hasPermission('volunteer') &&
            hasPermission('applications') &&
            hasPermission('bills') &&
            hasPermission('registration')
          }
          formatDateLong={formatDateLong}
          formatDate={formatDate}
          onOpenSubmitHrReport={() => {
                  setHrReportForm({
                    nature: '',
                    regardingMemberId: '',
                    regardingName: '',
                    regardingContact: '',
                    dateOccurred: '',
              details: '',
                  })
                  setHrReportError('')
                  setHrReportSuccess('')
                  setShowHrReportModal(true)
          }}
          onViewReport={(report) => {
                                setSelectedHrReport(report)
                                setShowHrReportViewModal(true)
                              }}
          onOpenPolicyViolationEmail={(report) => {
            if (!report?.regarding_member_id) return
            setSelectedHrReport(report)
            setPolicyViolationEmailSeed({
              memberId: report.regarding_member_id,
              nature: report.nature_of_complaint || '',
            })
            setShowPolicyViolationEmailModal(true)
          }}
        />
        )}

        {hasPermission('volunteer') &&
          hasPermission('applications') &&
          hasPermission('bills') &&
          hasPermission('registration') &&
          !viewAsData && (
            <ExecConductSection
              sectionId={DASHBOARD_SECTION_IDS.execConduct}
              sectionOrder={dashboardOrder.execConduct}
              removalProposals={removalProposals}
              resignationRows={execResignations}
              memberStrikeRows={memberStrikeRows}
              membersById={membersByIdForConduct}
              currentExecMemberId={member?.member_id}
              formatDateLong={formatDateLong}
              onConfirmRemovalSecond={handleSecondExecRemovalConfirm}
              onCancelRemovalProposal={handleCancelRemovalProposal}
              onUpdateResignationStatus={handleUpdateResignationStatus}
              onUpdateResignationNotes={handleUpdateResignationExecNotes}
              onDeleteResignation={handleDeleteResignation}
              onDeleteStrike={handleDeleteStrike}
              onDeactivateMemberFromDirectory={handleDeactivateMemberFromDirectory}
              onOpenHonorableExitEmailModal={() => setShowHonorableExitEmailModal(true)}
              onOpenRemovalNoticeEmailModal={() => setShowRemovalNoticeEmailModal(true)}
            />
          )}

        </Suspense>

        {!viewAsData && member && (member.blog === true || member.blog === 'true') && (
          <section
            id={DASHBOARD_SECTION_IDS.mediumBlog}
            className="mt-5 dashboard-section-anchor"
            style={{ order: dashboardOrder.mediumBlog }}
          >
            <h3>Medium (blog) login</h3>
            <div className="card mt-3 shadow-sm">
              <div className="card-body">
                <p className="text-muted mb-3">
                  SPAN uses one shared Medium account. Click below to tell the system to forward the next login email from that inbox to your official SPAN email, then open Medium and sign in using <strong>spanationwide@gmail.com</strong>.
                </p>
                <div className="d-flex flex-wrap gap-2 align-items-center">
                  <button
                    type="button"
                    className="btn btn-dark"
                    disabled={mediumOtpLoading}
                    onClick={handleMediumOtpArm}
                  >
                    {mediumOtpLoading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status" />
                        Arming…
                      </>
                    ) : (
                      <>
                        <i className="bi bi-shield-check me-1" />
                        I want to log in to Medium
                      </>
                    )}
                  </button>
                  <a
                    href="https://medium.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline-dark"
                  >
                    Open Medium
                  </a>
                </div>
                {mediumOtpSuccess && <div className="text-success small mt-3 mb-0">{mediumOtpSuccess}</div>}
                {mediumOtpError && <div className="text-danger small mt-3 mb-0">{mediumOtpError}</div>}
              </div>
            </div>
          </section>
        )}

        {/* Password Change */}
        <section
          id={DASHBOARD_SECTION_IDS.changePassword}
          className="mt-5 dashboard-section-anchor"
          style={{ order: dashboardOrder.changePassword }}
        >
          <h3>Change Password</h3>
          <div className="card mt-3">
            <div className="card-body">
              <form onSubmit={handlePasswordChange}>
                <div className="row">
                  <div className="col-md-6 mb-3">
                    <label htmlFor="newPassword" className="form-label">New Password</label>
                    <input
                      type="password"
                      className="form-control"
                      id="newPassword"
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                      required
                    />
                  </div>
                  <div className="col-md-6 mb-3">
                    <label htmlFor="confirmPassword" className="form-label">Confirm Password</label>
                    <input
                      type="password"
                      className="form-control"
                      id="confirmPassword"
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="btn btn-dark">Update Password</button>
                {passwordMessage && (
                  <div className={`mt-2 ${passwordMessage.includes('success') ? 'text-success' : 'text-danger'}`}>
                    {passwordMessage}
                  </div>
                )}
              </form>
            </div>
          </div>
        </section>

        {!viewAsData && member && !isMentor && (
          <ResignFromSpanSection
            sectionId={DASHBOARD_SECTION_IDS.resignFromSpan}
            sectionOrder={dashboardOrder.resignFromSpan}
            viewAsData={viewAsData}
            activeResignation={activeResignation}
            onSubmitResignation={handleSubmitResignationRequest}
            onWithdraw={handleWithdrawResignation}
            submitting={resignSubmitLoading}
          />
        )}
                </div>
                </div>

      <SpanCardPasswordModal
        open={showPasswordModal}
        qrPassword={qrPassword}
        setQrPassword={setQrPassword}
        qrPasswordError={qrPasswordError}
        onClose={() => setShowPasswordModal(false)}
        onConfirm={handleQrPasswordConfirm}
      />

      <VolunteerEntryModal
        open={showVolunteerModal}
        volunteerForm={volunteerForm}
        setVolunteerForm={setVolunteerForm}
        volunteerError={volunteerError}
        onClose={() => setShowVolunteerModal(false)}
        onSave={handleSaveVolunteer}
      />

      <LeaveRequestSubmitModal
        open={showRequestModal}
        onClose={() => setShowRequestModal(false)}
        requestForm={requestForm}
        setRequestForm={setRequestForm}
        requestError={requestError}
        requestSuccess={requestSuccess}
        onSubmit={handleSubmitRequest}
      />

      <LeaveRequestQuickReviewModal
        open={showRequestReviewModal}
        request={selectedRequestForReview}
        requestReviewAction={requestReviewAction}
        requestReviewNotes={requestReviewNotes}
        setRequestReviewNotes={setRequestReviewNotes}
        onClose={() => {
                setShowRequestReviewModal(false)
                setSelectedRequestForReview(null)
                setRequestReviewNotes('')
        }}
        onConfirm={handleRequestReviewSubmit}
      />

      <LeaveRequestViewModal
        open={showRequestViewModal}
        request={selectedRequestForView}
        onClose={() => {
                setShowRequestViewModal(false)
                setSelectedRequestForView(null)
        }}
        formatDate={formatDate}
        formatDateLong={formatDateLong}
        viewAsData={viewAsData}
        showExecReviewPanel={!viewAsData && (isExec || isTeamLeadUser)}
        requestReviewNotes={requestReviewNotes}
        setRequestReviewNotes={setRequestReviewNotes}
        onReviewFromView={handleRequestReviewSubmitFromView}
        onStatusChangeFromView={handleRequestStatusChangeFromView}
        onDeleteFromView={handleDeleteRequestFromView}
      />

      <SuggestionViewModal
        open={showSuggestionViewModal}
        suggestion={selectedSuggestionForView}
        onClose={() => {
                setShowSuggestionViewModal(false)
                setSelectedSuggestionForView(null)
        }}
        formatDateLong={formatDateLong}
        showMemberBlock={isExec}
        showExecReview={!viewAsData && isExec}
        suggestionReviewNotes={suggestionReviewNotes}
        setSuggestionReviewNotes={setSuggestionReviewNotes}
        onSaveComment={handleSuggestionCommentSave}
        onStatusChange={handleSuggestionStatusChangeFromView}
      />

      <MentorCredentialsModal
        open={!!mentorCredentialsModal}
        credentials={mentorCredentialsModal}
        onClose={() => setMentorCredentialsModal(null)}
      />

      <VolunteerSupervisorCommentModal
        open={showCommentModal}
        commentText={commentText}
        setCommentText={setCommentText}
        onClose={() => setShowCommentModal(false)}
        onSave={handleSaveComment}
      />

      <DeleteVolunteerEntryModal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteEntry}
      />

      <Suspense fallback={null}>
      <BillUploadModal
        open={showBillModal}
        billModalSourceAssignmentId={billModalSourceAssignmentId}
        publishLegiscanLookup={publishLegiscanLookup}
        billForm={billForm}
        setBillForm={setBillForm}
        setBillPdfFile={setBillPdfFile}
        billError={billError}
        billSuccess={billSuccess}
        allMembers={allMembers}
        onClose={closeBillUploadModal}
        onSave={handleSaveBill}
        onToggleCollaborator={handleBillCollaboratorToggle}
        setBillError={setBillError}
      />

      <BillEditModal
        open={showEditBillModal && !!selectedBillForEdit}
        editBillForm={editBillForm}
        setEditBillForm={setEditBillForm}
        setEditBillPdfFile={setEditBillPdfFile}
        billError={billError}
        billSuccess={billSuccess}
        allMembers={allMembers}
        showHiddenCheckbox={
          hasPermission('volunteer') &&
          hasPermission('applications') &&
          hasPermission('bills') &&
          hasPermission('registration')
        }
        onClose={() => setShowEditBillModal(false)}
        onSave={handleSaveEditBill}
        onToggleCollaborator={handleEditBillCollaboratorToggle}
        setBillError={setBillError}
      />

      <DeleteBillModal
        open={showDeleteBillModal}
        bill={selectedBillForDelete}
        billError={billError}
        onClose={() => setShowDeleteBillModal(false)}
        onConfirm={handleConfirmDeleteBill}
      />

      {/* Assign bill work — exec or policy team lead */}
      <AssignBillWorkModal
        open={showAssignBillModal}
        editingAssignment={editingAssignment}
        hideBillPrefill={assignBillModalHidePrefill}
        assignBillForm={assignBillForm}
        setAssignBillForm={setAssignBillForm}
        assignBillError={assignBillError}
        assignBillSaving={assignBillSaving}
        assignPrefillBillChoices={assignPrefillBillChoices}
        allBills={allBills}
        assigneePickerMembers={assigneePickerMembers}
        resolveMemberName={resolveBillAssignmentMemberName}
        onClose={closeAssignBillModal}
        onSave={handleSaveAssignBillModal}
      />

      <DeleteBillAssignmentModal
        open={showDeleteAssignmentModal}
        assignment={assignmentToDelete}
        error={deleteAssignmentError}
        saving={deleteAssignmentSaving}
        onClose={() => {
                setShowDeleteAssignmentModal(false)
                setAssignmentToDelete(null)
        }}
        onConfirm={handleConfirmDeleteBillAssignment}
      />

      <BillPdfPreviewModal
        bill={billPdfPreviewBill}
        onClose={() => setBillPdfPreviewBill(null)}
        getBillPdfUrl={getBillPdfUrl}
      />

      <MemberFormModal
        open={showMemberModal}
        editingMemberId={editingMemberId}
        memberForm={memberForm}
        setMemberForm={setMemberForm}
        memberError={memberError}
        memberSuccess={memberSuccess}
        showPermissionsSection={
          hasPermission('volunteer') &&
          hasPermission('applications') &&
          hasPermission('bills') &&
          hasPermission('registration')
        }
        markEmailAsManuallyEdited={() => {
          emailManuallyEdited.current = true
        }}
        onBackdropClose={() => setShowMemberModal(false)}
        onHeaderClose={() => {
                        setShowMemberModal(false)
                        setEditingMemberId(null)
                      }}
        onCancelFooter={() => setShowMemberModal(false)}
        onImportApplication={() => setShowImportApplicationModal(true)}
        onSave={handleSaveMember}
      />

      <ApplicationViewModal
        open={showApplicationModal && !!selectedApplication}
        application={selectedApplication}
        onClose={closeApplicationModal}
        formatDateLong={formatDateLong}
        applicationNumericGrade={applicationNumericGrade}
        setApplicationNumericGrade={setApplicationNumericGrade}
        applicationNotes={applicationNotes}
        setApplicationNotes={setApplicationNotes}
        onSaveNumericGrade={handleSaveApplicationNumericGrade}
        onOpenInviteEmail={openInviteEmailPreviewModal}
        onOpenMetWithDate={openMetWithDateModal}
        onOpenOnboardEmail={openOnboardScheduleEmailPreviewModal}
        onAccept={() => {
                              if (
                                window.confirm(
                                  `Accept ${selectedApplication.full_name}'s application?\n\nYou'll be able to add them as a member next.`
                                )
                              ) {
                                handleAcceptApplication()
                              }
                            }}
        onOpenRejectConfirm={() => {
                              setSendRejectionEmail(true)
                              setRejectionEmailReason(applicationNotes)
                              setShowRejectConfirmModal(true)
                            }}
        onResetToPending={() => {
                            if (window.confirm(`Reset ${selectedApplication.full_name}'s application to pending?`)) {
                              handleUpdateApplicationStatus('pending')
                            }
                          }}
        onOpenDeleteModal={() => setShowDeleteApplicationModal(true)}
        aiCheckResult={aiCheckResult}
        aiCheckLoading={aiCheckLoading}
        onCheckAi={handleCheckAiText}
      />

      <ImportApplicationModal
        open={showImportApplicationModal}
        applications={applications}
        formatDateLong={formatDateLong}
        onClose={() => setShowImportApplicationModal(false)}
        onImport={handleImportFromApplication}
      />


      <HrReportSubmitModal
        open={showHrReportModal}
        onClose={() => setShowHrReportModal(false)}
        hrReportForm={hrReportForm}
        setHrReportForm={setHrReportForm}
        hrReportError={hrReportError}
        hrReportSuccess={hrReportSuccess}
        onSubmit={handleSubmitHrReport}
        membersList={allMembers}
      />

      <HrReportViewModal
        open={showHrReportViewModal}
        report={selectedHrReport}
        onClose={() => setShowHrReportViewModal(false)}
        formatDateLong={formatDateLong}
        formatDate={formatDate}
        showExecStatusControls={
          hasPermission('volunteer') &&
          hasPermission('applications') &&
          hasPermission('bills') &&
          hasPermission('registration')
        }
        onUpdateStatus={handleUpdateHrReportStatus}
        showRecordStrikeForRegarding={
          !viewAsData &&
          hasPermission('volunteer') &&
          hasPermission('applications') &&
          hasPermission('bills') &&
          hasPermission('registration')
        }
        recordingStrike={recordingHrStrike}
        onRecordStrikeFromReport={handleRecordStrikeFromHrReport}
        showPolicyViolationEmail={
          !viewAsData &&
          hasPermission('volunteer') &&
          hasPermission('applications') &&
          hasPermission('bills') &&
          hasPermission('registration')
        }
        onOpenPolicyViolationEmail={() => {
          const report = selectedHrReport
          if (!report?.regarding_member_id) return
          setPolicyViolationEmailSeed({
            memberId: report.regarding_member_id,
            nature: report.nature_of_complaint || '',
          })
          setShowPolicyViolationEmailModal(true)
        }}
        canDelete={
          !viewAsData &&
          hasPermission('volunteer') &&
          hasPermission('applications') &&
          hasPermission('bills') &&
          hasPermission('registration')
        }
        onDelete={() => selectedHrReport?.report_id && handleDeleteHrReport(selectedHrReport.report_id)}
      />

      <MemberStrikeModal
        open={showStrikeModal && !!strikeModalMember}
        onClose={() => {
          setShowStrikeModal(false)
          setStrikeModalMember(null)
        }}
        memberRow={strikeModalMember}
        strikes={strikesForStrikeModal}
        strikeLimit={strikeModalMember ? strikeLimitForMember(strikeModalMember) : 3}
        atLimit={strikeModalMember ? memberAtStrikeLimitRow(strikeModalMember) : false}
        formatDateLong={formatDateLong}
        onAddManualStrike={handleAddManualStrike}
        onDeleteStrike={handleDeleteStrike}
        onOpenRemoval={() => {
          setRemovalModalMember(strikeModalMember)
          setShowStrikeModal(false)
          setShowRemovalModal(true)
        }}
      />

      <MemberRemovalModal
        open={showRemovalModal && !!removalModalMember}
        onClose={() => {
          setShowRemovalModal(false)
          setRemovalModalMember(null)
        }}
        memberRow={removalModalMember}
        currentExecMemberId={member?.member_id}
        pendingProposal={pendingRemovalForRemovalModal}
        onInitiateRemoval={handleInitiateRemovalProposal}
        onSecondExecConfirm={() =>
          pendingRemovalForRemovalModal &&
          handleSecondExecRemovalConfirm(pendingRemovalForRemovalModal)
        }
        onCancelProposal={() =>
          pendingRemovalForRemovalModal &&
          handleCancelRemovalProposal(pendingRemovalForRemovalModal)
        }
      />

      <HonorableExitEmailModal
        open={showHonorableExitEmailModal}
        onClose={() => setShowHonorableExitEmailModal(false)}
        supabase={supabase}
        membersList={allMembersForManagement}
      />

      <RemovalNoticeEmailModal
        open={showRemovalNoticeEmailModal}
        onClose={() => setShowRemovalNoticeEmailModal(false)}
        supabase={supabase}
        membersList={allMembersForManagement}
        onSent={async () => {
          await loadExecConductData()
          await loadAllMembersForManagement()
          await loadAllMembers()
        }}
      />

      <PolicyViolationEmailModal
        open={showPolicyViolationEmailModal}
        onClose={() => setShowPolicyViolationEmailModal(false)}
        supabase={supabase}
        membersList={allMembersForManagement}
        memberStrikeRows={memberStrikeRows}
        initialMemberId={policyViolationEmailSeed.memberId}
        initialNature={policyViolationEmailSeed.nature}
      />

      <DeleteApplicationConfirmModal
        open={showDeleteApplicationModal && !!selectedApplication}
        application={selectedApplication}
        onClose={() => setShowDeleteApplicationModal(false)}
        onConfirm={handleDeleteApplication}
      />

      <ApplicationInviteEmailPreviewModal
        open={showInviteEmailModal && !!selectedApplication}
        application={selectedApplication}
        inviteEmailPreview={inviteEmailPreview}
        inviteEmailPreviewLoading={inviteEmailPreviewLoading}
        inviteEmailSending={inviteEmailSending}
        onBackdropClose={() => {
                setShowInviteEmailModal(false)
                setInviteEmailPreview(null)
        }}
        onHeaderClose={() => {
                      if (!inviteEmailSending && !inviteEmailPreviewLoading) {
                        setShowInviteEmailModal(false)
                        setInviteEmailPreview(null)
                      }
                    }}
        onCancel={() => {
                      if (!inviteEmailSending) {
                        setShowInviteEmailModal(false)
                        setInviteEmailPreview(null)
                      }
                    }}
        onSend={handleSendInvitationEmailAndMarkInvited}
      />

      <ApplicationInviteEmailPreviewModal
        open={showFollowUpModal && !!followUpApplication}
        application={followUpApplication}
        inviteEmailPreview={followUpPreview}
        inviteEmailPreviewLoading={followUpPreviewLoading}
        inviteEmailSending={followUpSending}
        title="Send invitation follow-up"
        titleIcon="bi-arrow-repeat"
        description={
          <>
            Review the follow-up message below. When you confirm, the email is sent via Resend and this applicant&apos;s
            follow-up count is increased by one. The application stays in the <strong>Invited</strong> stage.
          </>
        }
        confirmLabel="Send follow-up"
        confirmingLabel="Sending…"
        onBackdropClose={() => {
          if (!followUpSending && !followUpPreviewLoading) closeFollowUpModal()
        }}
        onHeaderClose={() => {
          if (!followUpSending && !followUpPreviewLoading) closeFollowUpModal()
        }}
        onCancel={() => {
          if (!followUpSending) closeFollowUpModal()
        }}
        onSend={handleSendFollowUpEmail}
      />

      <ApplicationOnboardScheduleEmailPreviewModal
        open={showOnboardScheduleEmailModal && !!selectedApplication}
        application={selectedApplication}
        onboardScheduleWhen2meetUrl={onboardScheduleWhen2meetUrl}
        setOnboardScheduleWhen2meetUrl={setOnboardScheduleWhen2meetUrl}
        onboardScheduleDeadlineNote={onboardScheduleDeadlineNote}
        setOnboardScheduleDeadlineNote={setOnboardScheduleDeadlineNote}
        onboardScheduleEmailPreview={onboardScheduleEmailPreview}
        onboardScheduleEmailPreviewLoading={onboardScheduleEmailPreviewLoading}
        onboardScheduleEmailSending={onboardScheduleEmailSending}
        onRefreshPreview={() =>
          loadOnboardScheduleEmailPreview(onboardScheduleWhen2meetUrl, onboardScheduleDeadlineNote)
        }
        onBackdropClose={() => {
                setShowOnboardScheduleEmailModal(false)
                setOnboardScheduleEmailPreview(null)
        }}
        onHeaderClose={() => {
                      if (!onboardScheduleEmailSending && !onboardScheduleEmailPreviewLoading) {
                        setShowOnboardScheduleEmailModal(false)
                        setOnboardScheduleEmailPreview(null)
                      }
                    }}
        onCancel={() => {
                      if (!onboardScheduleEmailSending) {
                        setShowOnboardScheduleEmailModal(false)
                        setOnboardScheduleEmailPreview(null)
                      }
                    }}
        onSend={handleSendOnboardingScheduleEmailAndMarkOnboard}
      />

      <ApplicationRejectConfirmModal
        open={showRejectConfirmModal && !!selectedApplication}
        application={selectedApplication}
        sendRejectionEmail={sendRejectionEmail}
        setSendRejectionEmail={setSendRejectionEmail}
        rejectionEmailReason={rejectionEmailReason}
        setRejectionEmailReason={setRejectionEmailReason}
        rejectionEmailPreview={rejectionEmailPreview}
        rejectionEmailPreviewLoading={rejectionEmailPreviewLoading}
        rejectionEmailSending={rejectionEmailSending}
        onBackdropClose={() => {
                setShowRejectConfirmModal(false)
                setRejectionEmailPreview(null)
                setRejectionEmailPreviewLoading(false)
                setRejectionEmailReason('')
        }}
        onHeaderClose={() => {
                      if (!rejectionEmailSending) {
                        setShowRejectConfirmModal(false)
                        setRejectionEmailPreview(null)
                        setRejectionEmailPreviewLoading(false)
                        setRejectionEmailReason('')
                      }
                    }}
        onCancel={() => {
                      if (!rejectionEmailSending) {
                        setShowRejectConfirmModal(false)
                        setRejectionEmailPreview(null)
                        setRejectionEmailPreviewLoading(false)
                        setRejectionEmailReason('')
                      }
                    }}
        onConfirm={handleRejectApplication}
      />

      <ApplicationMetWithDateModal
        open={showMetWithDateModal && !!selectedApplication}
        application={selectedApplication}
        metWithDate={metWithDateInput}
        setMetWithDate={setMetWithDateInput}
        onClose={() => setShowMetWithDateModal(false)}
        onConfirm={confirmMetWithDate}
        disableBackdropClose={rejectionEmailSending}
      />

      <VolunteerVerificationModal
        open={showVerificationModal && !!verificationMember}
        verificationMember={verificationMember}
        verificationPdfUrl={verificationPdfUrl}
        verificationApprovedEntries={verificationApprovedEntries}
        selectedVerificationEntryIds={selectedVerificationEntryIds}
        verificationEntryCount={verificationEntryCount}
        verificationPreviewDirty={verificationPreviewDirty}
        verificationGenerating={verificationGenerating}
        verificationSending={verificationSending}
        onSelectionChange={handleVerificationSelectionChange}
        onRebuildPreview={handleRebuildVerificationPreview}
        onDismiss={() => {
                setShowVerificationModal(false)
                if (verificationPdfUrl) URL.revokeObjectURL(verificationPdfUrl)
                setVerificationPdfUrl(null)
                setVerificationPdfBase64(null)
                setVerificationMember(null)
                setVerificationApprovedEntries([])
                setSelectedVerificationEntryIds([])
                setVerificationPreviewDirty(false)
        }}
        onSend={handleConfirmSendVerification}
      />

      <PartnerFormModal
        open={showPartnerModal}
        editingPartnerId={editingPartnerId}
        partnerForm={partnerForm}
        setPartnerForm={setPartnerForm}
        partnerError={partnerError}
        partnerSuccess={partnerSuccess}
        currentLogoPreviewUrl={
          editingPartnerId
            ? (() => {
                const fn = partners.find((p) => p.partner_id === editingPartnerId)?.partner_logo
                return fn ? `${PARTNERS_IMAGES_BASE_URL}/${fn}` : null
              })()
            : null
        }
        setPartnerLogoFile={setPartnerLogoFile}
        onClose={() => setShowPartnerModal(false)}
        onSave={handleSavePartner}
      />

      <SchoolFormModal
        open={showSchoolModal}
        editingSchoolId={editingSchoolId}
        schoolForm={schoolForm}
        setSchoolForm={setSchoolForm}
        schoolError={schoolError}
        schoolSuccess={schoolSuccess}
        currentLogoPreviewUrl={
          editingSchoolId
            ? (() => {
                const row = schools.find((x) => (x.school_id ?? x.id) === editingSchoolId)
                const fn = row?.school_image
                return fn ? `${SCHOOLS_IMAGES_BASE_URL}/${fn}` : null
              })()
            : null
        }
        setSchoolLogoFile={setSchoolLogoFile}
        onClose={() => setShowSchoolModal(false)}
        onSave={handleSaveSchool}
      />

      <AdvisorFormModal
        open={showAdvisorModal}
        editingAdvisorId={editingAdvisorId}
        advisorForm={advisorForm}
        setAdvisorForm={setAdvisorForm}
        advisorError={advisorError}
        advisorSuccess={advisorSuccess}
        currentPhotoPreviewUrl={
          editingAdvisorId
            ? (() => {
                const fn = advisors.find((a) => a.advisor_id === editingAdvisorId)?.photo
                return fn ? `${ADVISORS_IMAGES_BASE_URL}/${fn}` : null
              })()
            : null
        }
        setAdvisorPhotoFile={setAdvisorPhotoFile}
        onClose={() => setShowAdvisorModal(false)}
        onSave={handleSaveAdvisor}
      />
      </Suspense>


    </div>
  )
}

export default DashboardPage

