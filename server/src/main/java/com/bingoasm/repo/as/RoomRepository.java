package com.bingoasm.repo.as;
import com.bingoasm.domain.as.Room;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
public interface RoomRepository extends JpaRepository<Room, Long> {
    List<Room> findBySchoolIdAndUseYnOrderByBuildingIdAscFloorIdAscRoomNoAsc(Long schoolId, String useYn);
    List<Room> findByFloorIdAndUseYn(Long floorId, String useYn);
}
