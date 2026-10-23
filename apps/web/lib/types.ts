import type { DriverStatus, HelpCap, RideDisplayStatus, RideStatus, VehicleCap } from '@psebc/shared';

export interface DriverCard {
  id: string;
  firstName: string;
  photoUrl: string | null;
  vehicle: { makeModel: string; colour: string; registration: string };
}

export interface RideCore {
  id: string;
  status: RideStatus;
  /** What to show: the status, or 'incident' once an incident is reported (until sign-off). */
  displayStatus: RideDisplayStatus;
  statusLabel: string;
  incidentReportedAt: string | null;
  pickupAt: string;
  destination: string;
  returnNeeded: boolean;
  returnAt: string | null;
  returnCancelled: boolean;
  companion: boolean;
  createdAt: string;
}

export interface MemberRideView {
  view: 'member' | 'office';
  ride: RideCore & {
    pickupAddress: string;
    needsNote: string;
    bookedByRole: string;
    cancelReason: string | null;
    pickedUpAt: string | null;
    droppedOffAt: string | null;
    notAtPickupAt: string | null;
    unmatchedFlaggedAt: string | null;
    signedOffAt: string | null;
  };
  member: { id: string; fullName: string; preferredName: string; phone?: string };
  driver: DriverCard | null;
  driverKnows: string[];
  canCancel: boolean;
  canRebook: boolean;
  canLog: boolean;
  memberLogDone: boolean;
  invites?: { driverId: string; name: string; status: string; declineReason: string | null }[];
  logs?: { driver: Record<string, unknown> | null; member: Record<string, unknown> | null };
}

export interface InviteView {
  view: 'invite';
  ride: { id: string; status: RideStatus; pickupAt: string; pickupArea: string; destination: string; returnNeeded: boolean; returnAt: string | null };
  needs: string[];
  invitedCount: number;
  inviteStatus: string;
  open: boolean;
  closedReason: string | null;
}

export interface DriverTripView {
  view: 'driver_trip';
  ride: RideCore & { pickupAddress: string; needsNote: string; pickedUpAt: string | null; droppedOffAt: string | null; notAtPickupAt: string | null; completedAt: string | null };
  member: {
    preferredName: string;
    fullName: string;
    phone: string;
    findingNotes: string;
    emergencyName: string;
    emergencyRelationship: string;
    emergencyPhone: string;
    howToHelp: string[];
    notesForDriver: string;
    healthNotes: string[];
    unwellInstructions: string;
    needsUpdatedAt: string;
  };
  driverLogDone: boolean;
  canWithdraw: boolean;
}

export interface DriverRecordView {
  view: 'driver_record';
  ride: RideCore & { pickedUpAt: string | null; droppedOffAt: string | null };
  message: string;
}

export type RideView = MemberRideView | InviteView | DriverTripView | DriverRecordView;

export interface MemberProfile {
  id: string;
  fullName: string;
  preferredName: string;
  addressLine: string;
  town: string;
  postcode: string;
  findingNotes: string;
  phone: string;
  canReceiveSms: boolean;
  contactMethod: string;
  bookedBy: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  hasRepresentative: boolean;
  representativeName: string;
  representativePhone: string;
  representativeRole: string;
  mobilityAids: string[];
  helpNeeded: string[];
  vehicleRequirement: string;
  notesForDriver: string;
  healthFlags: string[] | null;
  unwellInstructions: string | null;
  consentGiven: boolean;
  consentGivenBy: string | null;
  consentRecordedAt: string | null;
  needsUpdatedAt: string;
  status: 'active' | 'closed';
  closedAt: string | null;
  deleteAfter: string | null;
}

export interface DriverDetail {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  postcode: string;
  photoUrl: string | null;
  dbsNumber: string;
  dbsIssueDate: string;
  dbsRenewalDate: string;
  insuranceExpiry: string;
  vehicleMakeModel: string;
  vehicleColour: string;
  vehicleReg: string;
  passengerSeats: number;
  vehicleCaps: VehicleCap[];
  helpCaps: HelpCap[];
  status: DriverStatus;
  approvedUntil: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNotes: string;
  loneWorkingAcknowledgedAt: string | null;
  documents: { id: string; kind: string; filename: string; uploadedAt: string; url: string }[];
  exclusions: { memberId: string; name: string }[];
}
