import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {api} from '@/lib/api/client';
import {job,release,draft,sourceAsset,workshopSnapshot,ids} from '../../../tests/contracts/fixtures';
import {ManufacturerJobs} from './manufacturer-jobs';
import {ManufacturerPart} from './manufacturer-part';
vi.mock('@/features/parts/part-qr',()=>({PartQr:()=> <p>Stable part QR</p>}));
afterEach(()=>cleanup());
function client(approved=true){return {...api,jobs:{...api.jobs,list:vi.fn().mockResolvedValue([job,{...job,id:'other',workspaceId:'other',title:'Private other workspace'}]),get:vi.fn().mockResolvedValue({job:{...job,latestReleaseId:approved?ids.release:null},assets:[sourceAsset],draft,releases:[release]})},workshops:{...api.workshops,list:vi.fn().mockResolvedValue([workshopSnapshot])},flags:{...api.flags,list:vi.fn().mockResolvedValue([])}};}
it('lists only workspace parts and supports search and a dedicated handoff route',async()=>{render(<ManufacturerJobs workspaceId={ids.workspace} client={client()}/>);expect(await screen.findByText(job.title)).toBeVisible();expect(screen.queryByText('Private other workspace')).toBeNull();expect(screen.getByRole('link',{name:'View part handoff'})).toHaveAttribute('href',`/studio/manufacturing/jobs/${ids.job}?workspace=${ids.workspace}`);fireEvent.change(screen.getByLabelText('Search part name or number'),{target:{value:'unmatched'}});expect(screen.getByRole('status')).toHaveTextContent('No parts match');});
it('keeps draft operations out of an unapproved handoff',async()=>{render(<ManufacturerPart jobId={ids.job} workspaceId={ids.workspace} client={client(false)}/>);expect(await screen.findByText('Engineering approval pending')).toBeVisible();expect(screen.queryByRole('table')).toBeNull();expect(screen.getByRole('link',{name:'Open part previews'})).toHaveAttribute('href',`/parts/${ids.job}`);});
it('shows approved requirements without substituting a newer facility profile',async()=>{const c=client();c.workshops.list.mockResolvedValue([{...workshopSnapshot,id:'new-profile',name:'Changed setup'}]);render(<ManufacturerPart jobId={ids.job} workspaceId={ids.workspace} client={c}/>);expect(await screen.findByRole('table')).toBeVisible();expect(screen.queryByText('Changed setup')).toBeNull();expect(screen.getByText(/earlier facility profile is selected/)).toBeVisible();});
it('rejects a part from another workspace',async()=>{render(<ManufacturerPart jobId={ids.job} workspaceId="different" client={client()}/>);expect(await screen.findByRole('alert')).toHaveTextContent('does not belong');expect(screen.queryByRole('table')).toBeNull();});
